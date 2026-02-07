/*
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  mysqlId: number;
  name: string;
  email: string;
  avatar?: string;
  isOnline: boolean;
  lastSeen: Date;
}

const UserSchema: Schema<IUser> = new Schema(
  {
    mysqlId: { type: Number, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    avatar: { type: String, default: '' },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const User: Model<IUser> = mongoose.model<IUser>('User', UserSchema);

export default User;
*/
