// app/lib/models/Conversation.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: Date
  model?: string
}

export interface IConversation extends Document {
  id: string
  title: string
  messages: IMessage[]
  model: string
  createdAt: Date
  updatedAt: Date
}

const MessageSchema = new Schema<IMessage>({
  id: { type: String, required: true },
  role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  model: { type: String },
})

const ConversationSchema = new Schema<IConversation>(
  {
    id: { type: String, required: true, unique: true },
    title: { type: String, default: 'Nueva conversación' },
    messages: [MessageSchema],
    model: { type: String, default: 'gpt-4o-mini' },
  },
  { timestamps: true }
)

export const ConversationModel =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>('Conversation', ConversationSchema)
