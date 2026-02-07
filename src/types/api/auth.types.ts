import type { Request } from "express";
import type { JwtPayload } from "jsonwebtoken";


export interface SafeUser {
  userId: string;
  username: string;
  email: string;
  accountStatus: string;
  emailVerified: boolean;
}
export interface AuthenticatedRequest extends Request {

  user?: {
    userId: string;
    username: string;
    accountStatus: string;
    emailVerified: boolean;
    role?: string | null;
    //email: string;
  };
}
export interface CustomJwtPayload extends JwtPayload {
  userId: string;
  username: string;
  accountStatus: string;
  emailVerified: boolean;
  [key: string]: any;
}