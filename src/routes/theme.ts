import express, { Router } from 'express';
import themeController from '../controllers/ThemeController.js';

const themeRouter: Router = express.Router();

themeRouter.get('/', themeController.getAllThemes);

export default themeRouter;
