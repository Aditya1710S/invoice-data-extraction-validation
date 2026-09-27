import { Router } from "express";
import { getDashboardStats } from "../controllers/invoices.controller.js";

export const dashboardRouter = Router();

dashboardRouter.get("/stats", getDashboardStats);
