// socket-test.js
// Run this with Node.js to test your Socket.io server connection
const { io } = require("socket.io-client");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("Socket.io Connection Test Utility");
console.log("=================================");

rl.question("Enter server URL (e.g. http://localhost:8080): ", (serverUrl) => {
  rl.question("Enter socket.io path (default: /logs): ", (path) => {
    path = path || "/logs";

    rl.question("Enter auth token: ", (token) => {
      console.log(`\nConnecting to ${serverUrl} with path ${path}...`);

      const socket = io(serverUrl, {
        path: path,
        auth: { token },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 3,
        timeout: 10000,
      });

      socket.on("connect", () => {
        console.log("\n✅ Connected successfully!");
        console.log(`Socket ID: ${socket.id}`);
        console.log(`Transport: ${socket.io.engine.transport.name}`);

        // Subscribe to all log levels
        const levels = ["error", "warn", "info", "http", "debug"];
        socket.emit("subscribe", levels);
        console.log(`Subscribed to log levels: ${levels.join(", ")}`);

        console.log("\nWaiting for logs... (press Ctrl+C to exit)");
      });

      socket.on("connect_error", (err) => {
        console.error("\n❌ Connection error:", err.message);
        if (err.message.includes("ECONNREFUSED")) {
          console.log("\nTips:");
          console.log("- Make sure your server is running");
          console.log("- Check if the port is correct");
          console.log(
            "- Verify there are no firewalls blocking the connection"
          );
        } else if (err.message.includes("Authentication")) {
          console.log("\nTips:");
          console.log("- Verify your auth token is correct");
          console.log(
            "- Check if LOG_ACCESS_TOKEN is properly set on your server"
          );
        }
      });

      socket.on("error", (err) => {
        console.error("\n❌ Socket error:", err);
      });

      socket.on("disconnect", (reason) => {
        console.log(`\n⚠️ Disconnected: ${reason}`);
      });

      socket.on("log", (data) => {
        // Format the timestamp
        const timestamp = new Date(data.timestamp).toLocaleTimeString();
        // Create colored output based on log level
        let levelDisplay;
        switch (data.level) {
          case "error":
            levelDisplay = "\x1b[31mERROR\x1b[0m";
            break;
          case "warn":
            levelDisplay = "\x1b[33mWARN \x1b[0m";
            break;
          case "info":
            levelDisplay = "\x1b[36mINFO \x1b[0m";
            break;
          case "http":
            levelDisplay = "\x1b[32mHTTP \x1b[0m";
            break;
          case "debug":
            levelDisplay = "\x1b[90mDEBUG\x1b[0m";
            break;
          default:
            levelDisplay = data.level.toUpperCase().padEnd(5);
        }

        console.log(`[${timestamp}] ${levelDisplay} - ${data.message}`);

        // If there's a requestId, display it
        if (data.requestId) {
          console.log(`  RequestID: ${data.requestId}`);
        }
      });

      // Handle clean exit
      rl.on("SIGINT", () => {
        console.log("\nDisconnecting and exiting...");
        socket.disconnect();
        rl.close();
        process.exit(0);
      });
    });
  });
});
