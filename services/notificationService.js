const Notification = require("../models/Notification");
const User = require("../models/User");
const { Expo } = require("expo-server-sdk");

// Initialize Expo SDK
const expo = new Expo();

class NotificationService {
  // Create a notification in the database
  async createNotification(user, title, message, type = "system", data = {}) {
    try {
      const notification = new Notification({
        user,
        title,
        message,
        type,
        data,
      });

      await notification.save();

      // Attempt to send push notification
      await this.sendPushNotification(user, title, message, type, data);

      return notification;
    } catch (error) {
      console.error("Error creating notification:", error);
      throw error;
    }
  }

  // Send push notification via Expo
  async sendPushNotification(userId, title, message, type, data = {}) {
    try {
      // Get user's expo push token
      const user = await User.findById(userId);

      if (!user || !user.expoPushToken) {
        return { success: false, message: "No push token available" };
      }

      const pushToken = user.expoPushToken;

      // Validate Expo push token
      if (!Expo.isExpoPushToken(pushToken)) {
        console.error(`Push token ${pushToken} is not a valid Expo push token`);
        return { success: false, message: "Invalid push token" };
      }

      // Create the message
      const messages = [
        {
          to: pushToken,
          sound: "default",
          title,
          body: message,
          data: { ...data, type },
        },
      ];

      // Send the messages
      const chunks = expo.chunkPushNotifications(messages);
      const tickets = [];

      for (let chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          console.error("Error sending push notification chunk:", error);
        }
      }

      return { success: true, tickets };
    } catch (error) {
      console.error("Error sending push notification:", error);
      return { success: false, error: error.message };
    }
  }

  // Get user notifications with pagination
  async getUserNotifications(user, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      const [notifications, total] = await Promise.all([
        Notification.find({ user, read: false })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),

        Notification.countDocuments({ user }),
      ]);

      return {
        notifications,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("Error fetching user notifications:", error);
      throw error;
    }
  }

  // Get unread notification count
  async getUnreadCount(user) {
    try {
      return await Notification.countDocuments({
        user,
        read: false,
      });
    } catch (error) {
      console.error("Error getting unread count:", error);
      throw error;
    }
  }

  // Mark a notification as read
  async markAsRead(notificationId, user) {
    try {
      const result = await Notification.updateOne(
        { _id: notificationId, user },
        { $set: { read: true } }
      );

      return result.modifiedCount > 0;
    } catch (error) {
      console.error("Error marking notification as read:", error);
      throw error;
    }
  }

  // Mark all notifications as read
  async markAllAsRead(user) {
    try {
      const result = await Notification.updateMany(
        { user, read: false },
        { $set: { read: true } }
      );

      return result.modifiedCount;
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      throw error;
    }
  }
}

module.exports = new NotificationService();
