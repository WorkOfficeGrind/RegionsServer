// directory-mapper.js
const fs = require("fs");
const path = require("path");

// Directories and files to ignore
const ignoreDirs = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".idea",
  ".vscode",
];

const ignoreFiles = [
  ".env",
  ".DS_Store",
  ".gitignore",
  "package-lock.json",
  "yarn.lock",
];

// Max depth to traverse (set to 0 for unlimited)
const MAX_DEPTH = 10;

/**
 * Maps the directory structure
 * @param {string} dir - The directory to start mapping from
 * @param {string} prefix - Prefix for visual representation
 * @param {number} depth - Current depth level
 * @returns {string} - The directory structure as a string
 */
function mapDirectory(dir, prefix = "", depth = 0) {
  if (depth > MAX_DEPTH && MAX_DEPTH !== 0) return "";

  let output = "";

  try {
    const items = fs.readdirSync(dir);

    // Sort items: directories first, then files
    const sortedItems = items.sort((a, b) => {
      const aIsDir = fs.statSync(path.join(dir, a)).isDirectory();
      const bIsDir = fs.statSync(path.join(dir, b)).isDirectory();

      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

    sortedItems.forEach((item, index) => {
      const itemPath = path.join(dir, item);
      const isLast = index === sortedItems.length - 1;
      const isDirectory = fs.statSync(itemPath).isDirectory();

      // Skip ignored directories and files
      if (
        (isDirectory && ignoreDirs.includes(item)) ||
        (!isDirectory && ignoreFiles.includes(item))
      ) {
        return;
      }

      // Create new prefix for current item
      const newPrefix = prefix + (isLast ? "└── " : "├── ");

      // Add the current item to output
      output += newPrefix + item + "\n";

      // Traverse subdirectories
      if (isDirectory) {
        const childPrefix = prefix + (isLast ? "    " : "│   ");
        output += mapDirectory(itemPath, childPrefix, depth + 1);
      }
    });
  } catch (error) {
    console.error(`Error reading directory ${dir}: ${error.message}`);
  }

  return output;
}

/**
 * Map project structure and print to console
 */
function mapProject() {
  const rootDir = process.cwd();
  const projectName = path.basename(rootDir);

  console.log(`Project structure for: ${projectName}\n`);
  console.log(mapDirectory(rootDir));
}

// Execute if run directly
if (require.main === module) {
  mapProject();
}

module.exports = { mapDirectory, mapProject };
