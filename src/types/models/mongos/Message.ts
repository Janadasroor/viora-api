/*
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IReadBy {
  userId?: number;
  readAt?: Date;
}

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  senderId: number;
  messageType: 'text' | 'image' | 'audio' | 'video' | 'file';
  content?: string;
  mediaUrl?: string;
  isRead: boolean;
  readBy: IReadBy[];
  isDeleted:Boolean;
  deletedAt?:Date;
  deletedFor: number[];
  createdAt?: Date;
  updatedAt?: Date;
}

const MessageSchema: Schema<IMessage> = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: Number, required: true },
    messageType: { type: String, enum: ['text', 'image', 'audio', 'video', 'file'], default: 'text' },
    content: {
      type: String,
      required: function (this: IMessage) {
        return this.messageType === 'text';
      },
    },
    mediaUrl: { type: String, default: '' },
    isRead: { type: Boolean, default: false },
    readBy: [
      {
        userId: { type: Number },
        readAt: { type: Date, default: Date.now },
      },
    ],
    isDeleted :[{type:Boolean,default:false}],
    deletedAt :[{type:Date}],
    deletedFor: [{ type: Number }],
  },
  { timestamps: true }
);

// Index for faster queries
MessageSchema.index({ conversationId: 1, createdAt: -1 });

const Message: Model<IMessage> = mongoose.model<IMessage>('Message', MessageSchema);

export default Message;
*/
