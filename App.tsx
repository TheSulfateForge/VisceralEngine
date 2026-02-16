
import React from 'react';
import { useGameStore } from './store';
import { MainLayout } from './components/layout/MainLayout';
import { LandingView } from './components/views/LandingView';
import { CreatorView } from './components/views/CreatorView';
import { ScenarioSelectionView } from './components/views/ScenarioSelectionView';
import { ChatView } from './components/views/ChatView';
import { CharacterView } from './components/views/CharacterView';
import { WorldView } from './components/views/WorldView';
import { ModalManager } from './components/modals/ModalManager';
import { ToastProvider } from './components/providers/ToastProvider';
import { ToastContainer } from './components/ui/ToastContainer';
import { UpdateNotification } from './components/common/UpdateNotification';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useAutosave } from './hooks/usePersistence';
import { useGameEffects } from './hooks/useGameEffects';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

// Global Effect Handler component
const GameLogicController: React.FC = () => {
    // We mount hooks here that need to run globally
    useAutosave();
    useGameEffects();
    useKeyboardShortcuts();
    return null;
};

const GameContent: React.FC = () => {
  const { ui } = useGameStore();

  const renderView = () => {
    switch (ui.view) {
        case 'landing':
            return <LandingView />;
        case 'creator':
            return <CreatorView />;
        case 'scenario':
            return <ScenarioSelectionView />;
        case 'game':
            return (
                <MainLayout>
                    {ui.activeTab === 'chat' && <ChatView />}
                    {ui.activeTab === 'character' && <CharacterView />}
                    {ui.activeTab === 'world' && <WorldView />}
                </MainLayout>
            );
        default: return null;
    }
  };

  return (
    <>
      <GameLogicController />
      <ToastContainer />
      <UpdateNotification />
      <ModalManager />
      {renderView()}
    </>
  );
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
        <ToastProvider>
            <GameContent />
        </ToastProvider>
    </ErrorBoundary>
  );
};

export default App;
