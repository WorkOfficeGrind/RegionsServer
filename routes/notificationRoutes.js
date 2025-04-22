const express = require("express");
const router = express.Router();
const notificationService = require("../services/notificationService");
const { authenticate } = require("../middlewares/authMiddleware");
const apiResponse = require("../utils/apiResponse"); // Import the apiResponse utility

// Get all notifications for a user
router.get("/", authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const result = await notificationService.getUserNotifications(
      req.user.id,
      page,
      limit
    );

    // res.json(result);
     return apiResponse.success(
       res,
       200,
       "Notifications Fetched Successfully!",
       "Your notifications have been fetched.",
       { ...result }
     );
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
});

// Get unread count
router.get("/unread-count", authenticate, async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);
    // res.json({ count });

    return apiResponse.success(
      res,
      200,
      "Unread Count",
      "Unread notification count retrieved successfully",
      { count }
    );
  } catch (error) {
    console.error("Failed to fetch unread count:", error);
    res.status(500).json({ message: "Failed to fetch unread count" });
  }
});

// Mark notification as read
router.put("/:id/read", authenticate, async (req, res) => {
  try {
    const success = await notificationService.markAsRead(
      req.params.id,
      req.user.id
    );

    if (success) {
      res.json({ message: "Notification marked as read" });
    } else {
      res.status(404).json({ message: "Notification not found" });
    }
  } catch (error) {
    console.error("Failed to mark notification as read:", error);
    res.status(500).json({ message: "Failed to mark notification as read" });
  }
});

// Mark all notifications as read
router.put("/read-all", authenticate, async (req, res) => {
  try {
    const count = await notificationService.markAllAsRead(req.user.id);
    res.json({ message: `${count} notifications marked as read` });
  } catch (error) {
    console.error("Failed tko mark all notifications as read:", error);
    res
      .status(500)
      .json({ message: "Failed to mark all notifications as read" });
  }
});

module.exports = router;
