/*
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IConversation extends Document {
  members: number[];
  name: string;
  isGroup: boolean;
  groupAdmin?: number;
  lastMessage?: mongoose.Types.ObjectId;
  lastMessageTime: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const ConversationSchema: Schema<IConversation> = new Schema(
  {
    members: [{ type: Number, required: true }],
    name: { type: String, default: '' },
    isGroup: { type: Boolean, default: false },
    groupAdmin: { type: Number },
    lastMessage: { type: Schema.Types.ObjectId, ref: 'Message' },
    lastMessageTime: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Index for faster queries
ConversationSchema.index({ members: 1 });

const Conversation: Model<IConversation> = mongoose.model<IConversation>('Conversation', ConversationSchema);

export default Conversation;
*/