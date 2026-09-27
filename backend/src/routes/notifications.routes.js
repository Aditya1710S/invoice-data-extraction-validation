import { Router } from "express";
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "../controllers/invoices.controller.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", getNotifications);
notificationsRouter.post("/read-all", markAllNotificationsAsRead);
notificationsRouter.post("/:id/read", markNotificationAsRead);
