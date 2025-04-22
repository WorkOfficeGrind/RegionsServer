

require("dotenv").config();
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const { Readable } = require("stream");
const { v4: uuidv4 } = require("uuid");
const mongoose = require("mongoose");
const apiResponse = require("../utils/apiResponse");
const config = require("./config");
const { logger } = require("./logger");

// Configure Cloudinary with timeout
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  timeout: config.cloudinary.timeout || 60000,
});

// Create memory storage for temporary buffer
const memoryStorage = multer.memoryStorage();

// Create multer upload middleware with memory storage
const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: config.uploads.maxFileSize || 10 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Log the file info for debugging
    logger.debug("File upload attempt details", {
      userId: req.user?._id,
      requestId: req.id,
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      endpoint: `${req.method} ${req.originalUrl}`,
    });
    
    // Check file type
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    
    if (mimetype) {
      return cb(null, true);
    }
    
    logger.warn("Invalid file type rejected", {
      userId: req.user?._id,
      requestId: req.id,
      mimetype: file.mimetype,
      originalname: file.originalname
    });
    cb(new Error("Only image files (JPEG, JPG, PNG, GIF) are allowed"));
  }
});

// Function to stream buffer to Cloudinary with retry logic
const streamToCloudinary = async (buffer, options = {}, userId, requestId) => {
  const maxRetries = config.cloudinary.maxRetries || 3;
  let attempts = 0;
  let lastError;
  
  while (attempts < maxRetries) {
    attempts++;
    try {
      logger.debug("Attempting Cloudinary upload", {
        userId,
        requestId,
        attempt: attempts,
        maxRetries,
        folder: options.folder || "prime-id-verification"
      });
      
      const result = await new Promise((resolve, reject) => {
        // Create a readable stream from buffer
        const stream = new Readable();
        stream.push(buffer);
        stream.push(null);
        
        // Default options with folder and unique ID
        const defaultOptions = {
          folder: config.cloudinary.folder || "prime-id-verification",
          public_id: uuidv4(),
          resource_type: "image",
          timeout: config.cloudinary.timeout || 60000
        };
        
        // Create upload stream to Cloudinary
        const uploadStream = cloudinary.uploader.upload_stream(
          { ...defaultOptions, ...options },
          (error, result) => {
            if (error) {
              logger.error("Cloudinary upload error", {
                userId,
                requestId,
                attempt: attempts,
                error: error.message,
                code: error.http_code
              });
              return reject(error);
            }
            
            logger.info("Cloudinary upload success", {
              userId,
              requestId,
              attempt: attempts,
              publicId: result.public_id,
              url: result.secure_url,
              fileSize: result.bytes
            });
            resolve(result);
          }
        );
        
        // Pipe buffer stream to Cloudinary
        stream.pipe(uploadStream);
      });
      
      return result;
    } catch (error) {
      lastError = error;
      logger.warn(`Cloudinary upload attempt ${attempts} failed`, {
        userId,
        requestId,
        error: error.message,
        statusCode: error.http_code
      });
      
      // Wait with exponential backoff before retrying
      if (attempts < maxRetries) {
        const delay = 1000 * Math.pow(2, attempts - 1); // 1s, 2s, 4s, etc.
        logger.debug(`Waiting ${delay}ms before retry`, { userId, requestId });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  logger.error("All Cloudinary upload attempts failed", {
    userId,
    requestId,
    maxRetries,
    lastError: lastError?.message,
    lastErrorCode: lastError?.http_code
  });
  
  throw lastError || new Error('Max upload retries exceeded');
};

// Middleware to handle multiple file uploads and stream to Cloudinary
const uploadAndStreamToCloudinary = (...fieldNames) => {
  return async (req, res, next) => {
    const requestStartTime = Date.now();
    const requestId = req.id;
    const userId = req.user?._id;
    
    // Track session state for MongoDB transaction
    let sessionActive = false;
    const session = await mongoose.startSession();
    
    logger.info("File upload process started", {
      userId,
      requestId,
      endpoint: `${req.method} ${req.originalUrl}`,
      clientIP: req.ip,
      userAgent: req.headers["user-agent"],
      fields: fieldNames.join(', ')
    });
    
    try {
      session.startTransaction();
      sessionActive = true;
      logger.debug("MongoDB transaction started for file upload", { requestId });
      
      // Apply the multer upload middleware to handle multiple files
      await new Promise((resolve, reject) => {
        upload.fields(fieldNames.map(field => ({ name: field })))(req, res, (err) => {
          if (err) {
            if (err instanceof multer.MulterError) {
              logger.warn(`Multer upload error: ${err.code}`, {
                userId,
                requestId,
                error: err.message,
                code: err.code
              });
              return reject({
                statusCode: 400,
                message: err.code === 'LIMIT_FILE_SIZE' 
                  ? `File size exceeds limit of ${config.uploads.maxFileSize / (1024 * 1024)}MB`
                  : err.message
              });
            }
            logger.error(`Upload error`, {
              userId, 
              requestId,
              error: err.message
            });
            return reject({
              statusCode: 500,
              message: err.message
            });
          }
          resolve();
        });
      });
      
      // Check if any files were uploaded
      if (!req.files || Object.keys(req.files).length === 0) {
        logger.debug("No files uploaded in request", { userId, requestId });
        // No files uploaded - just proceed to next middleware
        await session.commitTransaction();
        session.endSession();
        sessionActive = false;
        return next();
      }
      
      // Store Cloudinary upload results
      req.cloudinaryFiles = {};
      
      // Process each uploaded file
      for (const fieldName of fieldNames) {
        const files = req.files[fieldName];
        
        // Skip if no file for this field
        if (!files || files.length === 0) continue;
        
        logger.debug(`Processing ${files.length} files for field ${fieldName}`, {
          userId,
          requestId
        });
        
        // Process each file in the field (usually just one)
        const uploadResults = [];
        
        for (const file of files) {
          // Extract file extension
          const extension = file.originalname.split('.').pop().toLowerCase();
          
          // Stream the file buffer to Cloudinary
          const uploadResult = await streamToCloudinary(
            file.buffer, 
            {
              public_id: `${fieldName}-${Date.now()}`,
              format: extension,
              transformation: [{ quality: "auto" }]
            },
            userId,
            requestId
          );
          
          uploadResults.push(uploadResult);
        }
        
        // Store results - if single file, store the result directly
        req.cloudinaryFiles[fieldName] = (uploadResults.length === 1) 
          ? uploadResults[0] 
          : uploadResults;
      }
      
      logger.info("File uploads completed successfully", {
        userId,
        requestId,
        processingTime: `${Date.now() - requestStartTime}ms`,
        uploadedFields: Object.keys(req.cloudinaryFiles).join(', ')
      });
      
      // Commit the transaction
      await session.commitTransaction();
      session.endSession();
      sessionActive = false;
      
      // Continue to next middleware
      next();
    } catch (error) {
      logger.error("File upload process critical error", {
        userId,
        requestId,
        error: error.message,
        stack: error.stack,
        processingTime: `${Date.now() - requestStartTime}ms`
      });
      
      // Ensure transaction is aborted if still active
      if (sessionActive) {
        try {
          await session.abortTransaction();
          session.endSession();
          logger.debug("Transaction aborted due to error", { requestId });
        } catch (sessionError) {
          logger.error("Error aborting transaction", {
            requestId,
            error: sessionError.message
          });
        }
      }
      
      // Send appropriate error response based on error type
      if (error.statusCode === 400) {
        return apiResponse.badRequest(res, "Bad Request", error.message);
      } else {
        return apiResponse.error(res, 500, "Error uploading files", {
          errorId: requestId,
          message: error.message
        });
      }
    }
  };
};

module.exports = {
  cloudinary,
  upload,
  streamToCloudinary,
  uploadAndStreamToCloudinary
};