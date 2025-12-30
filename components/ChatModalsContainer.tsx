
import React from 'react';
import { DeleteChatModal, EmailAlertModal } from './ChatModals';
import AiAvatarModal from './AiAvatarModal';
import UserProfileModal from './UserProfileModal';
import { Presence, Subscriber } from '../types';

interface ChatModalsContainerProps {
  showDeleteModal: boolean;
  setShowDeleteModal: (s: boolean) => void;
  handleDeleteChat: () => void;
  isDeleting: boolean;
  
  showEmailModal: boolean;
  setShowEmailModal: (s: boolean) => void;
  saveEmailSubscription: () => void;
  isSavingEmail: boolean;
  emailAlertsEnabled: boolean;
  handleEmailToggle: () => void;
  emailAddress: string;
  setEmailAddress: (e: string) => void;

  showAiAvatarModal: boolean;
  setShowAiAvatarModal: (s: boolean) => void;
  aiAvatarUrl: string;
  roomKey: string;
  setAiAvatarUrl: (u: string) => void;

  selectedUserPresence: Presence | null;
  selectedUserSubscriber: Subscriber | null;
  roomCreatorId: string | null;
  closeUserProfile: () => void;
}

const ChatModalsContainer: React.FC<ChatModalsContainerProps> = (props) => {
  return (
    <>
      <DeleteChatModal 
        show={props.showDeleteModal} 
        onCancel={() => props.setShowDeleteModal(false)} 
        onConfirm={props.handleDeleteChat} 
        isDeleting={props.isDeleting} 
      />

      <EmailAlertModal 
        show={props.showEmailModal} 
        onCancel={() => props.setShowEmailModal(false)} 
        onSave={props.saveEmailSubscription} 
        isSaving={props.isSavingEmail} 
        emailAlertsEnabled={props.emailAlertsEnabled} 
        onToggleOff={props.handleEmailToggle} 
        emailAddress={props.emailAddress} 
        setEmailAddress={props.setEmailAddress} 
      />

      <AiAvatarModal
        show={props.showAiAvatarModal}
        onClose={() => props.setShowAiAvatarModal(false)}
        currentAvatarUrl={props.aiAvatarUrl}
        roomKey={props.roomKey}
        onUpdate={props.setAiAvatarUrl}
      />

      {props.selectedUserPresence && (
        <UserProfileModal
          user={props.selectedUserPresence}
          subscriberInfo={props.selectedUserSubscriber}
          isRoomOwner={props.selectedUserPresence.uid === props.roomCreatorId}
          onClose={props.closeUserProfile}
        />
      )}
    </>
  );
};

export default ChatModalsContainer;
