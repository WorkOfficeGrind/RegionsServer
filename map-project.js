// Save this as map-project.js in your project root directory
const fs = require("fs");
const path = require("path");

// Configuration
const ignoreDirs = [
  "node_modules",
  ".git",
  ".expo",
  "build",
  "dist",
  ".expo-shared",
  "android",
  "ios",
];
const relevantExtensions = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".env",
  ".config.js",
];
const apiKeywords = [
  "api",
  "service",
  "http",
  "axios",
  "fetch",
  "request",
  "endpoint",
];
const maxDepth = 5;

// Output files
const structureOutputFile = "project-structure.txt";
const apiFilesOutputFile = "api-related-files.txt";

let structureOutput = "PROJECT STRUCTURE:\n\n";
let apiFilesOutput = "API-RELATED FILES:\n\n";

// Function to map folder structure
function mapFolderStructure(directory, depth = 0) {
  const indent = "  ".repeat(depth);

  try {
    const files = fs.readdirSync(directory);

    for (const file of files) {
      if (ignoreDirs.includes(file)) {
        continue;
      }

      const filePath = path.join(directory, file);
      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        structureOutput += `${indent}📁 ${file}/\n`;

        if (depth < maxDepth) {
          mapFolderStructure(filePath, depth + 1);
        }
      } else {
        const fileExt = path.extname(file);

        if (
          relevantExtensions.includes(fileExt) ||
          file === "package.json" ||
          file.includes("config")
        ) {
          structureOutput += `${indent}📄 ${file}\n`;
        }

        // Check for API-related files
        if ([".ts", ".tsx", ".js", ".jsx"].includes(fileExt)) {
          if (
            apiKeywords.some((keyword) => file.toLowerCase().includes(keyword))
          ) {
            apiFilesOutput += `${filePath}\n`;

            // Optionally read and include file content for API files
            try {
              const content = fs.readFileSync(filePath, "utf8");
              apiFilesOutput += "---\n";
              apiFilesOutput += content;
              apiFilesOutput += "\n---\n\n";
            } catch (err) {
              apiFilesOutput += `Error reading file: ${err.message}\n\n`;
            }
          }
        }
      }
    }
  } catch (error) {
    structureOutput += `${indent}Error reading directory: ${error.message}\n`;
  }
}

// Start mapping from the project root
console.log("Mapping project structure...");
mapFolderStructure(".");

// Add package.json info
try {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  structureOutput += "\nPACKAGE.JSON DEPENDENCIES:\n";
  structureOutput += "  Dependencies:\n";

  if (packageJson.dependencies) {
    Object.entries(packageJson.dependencies).forEach(([pkg, version]) => {
      structureOutput += `    ${pkg}: ${version}\n`;
    });
  }

  structureOutput += "  Dev Dependencies:\n";
  if (packageJson.devDependencies) {
    Object.entries(packageJson.devDependencies).forEach(([pkg, version]) => {
      structureOutput += `    ${pkg}: ${version}\n`;
    });
  }
} catch (error) {
  structureOutput += `\nError reading package.json: ${error.message}\n`;
}

// Write output to files
fs.writeFileSync(structureOutputFile, structureOutput);
fs.writeFileSync(apiFilesOutputFile, apiFilesOutput);

console.log(`Project structure written to ${structureOutputFile}`);
console.log(`API-related files written to ${apiFilesOutputFile}`);

