import { Router } from 'express';
import { validate } from '../middleware/validation.js';
import * as messengerSchemas from '../validators/schemas/messenger.schemas.js';
import {
    startPrivateChat,
    getMessages,
    deleteMessage,
    markAllMessagesAsRead,
    markMessageAsRead,
    getConversationById,
    updateConversation,
    deleteConversation,
    createConversation,
    getConversations,
    startGroupChat
} from '../controllers/MessengerController.js';

const router = Router();

router.post('/start-private-chat', validate(messengerSchemas.startPrivateChatSchema), startPrivateChat);
router.post('/start-group-chat', validate(messengerSchemas.startGroupChatSchema), startGroupChat);
router.get('/messages/:conversationId', validate(messengerSchemas.getMessagesSchema), getMessages);
router.delete('/:messageId', validate(messengerSchemas.deleteMessageSchema), deleteMessage);
router.put('/:messageId/read', validate(messengerSchemas.messageIdSchema), markMessageAsRead);
router.put('/:conversationId/read-all', validate(messengerSchemas.conversationIdSchema), markAllMessagesAsRead);
router.put('/conversation/:conversationId', validate(messengerSchemas.updateConversationSchema), updateConversation);
router.delete('/conversation/:conversationId', validate(messengerSchemas.conversationIdSchema), deleteConversation);
router.post('/conversation', validate(messengerSchemas.createConversationSchema), createConversation);
router.get('/conversations', validate(messengerSchemas.getConversationsSchema), getConversations);
router.get('/conversation/:id', getConversationById);

export default router;