/*
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IReelView extends Document {
  userId: string;
  reelId: number;
  viewDate: Date;
}

const ReelViewSchema: Schema<IReelView> = new Schema({
  userId: { type: Number, required: true },
  reelId: { type: Number, required: true },
  viewDate: { type: Date, default: Date.now },
});

const ReelView: Model<IReelView> = mongoose.model<IReelView>('ReelView', ReelViewSchema);

export default ReelView;
*/
