
import React from 'react';
import { useGameStore } from '../../store';
import { KeyPromptModal } from './KeyPromptModal';
import { SaveLoadModal } from './SaveLoadModal';
import { SettingsOverlay } from './SettingsOverlay';
import { GalleryModal } from './GalleryModal';
import { DebugModal } from './DebugModal';
import { useGeminiClient } from '../../hooks/useGeminiClient';
import { usePersistence } from '../../hooks/usePersistence';
import { useSavedGames } from '../../hooks/useSavedGames';

export const ModalManager: React.FC = () => {
    const store = useGameStore();
    const { handleKeyLink } = useGeminiClient();
    const { saveToDb, loadFromDb, handleExport, handleImport } = usePersistence();
    const { saveList, deleteSave } = useSavedGames(store.showLoadModal || store.showSaveModal);
    
    // Local state for the save input
    const [saveName, setSaveName] = React.useState('');

    const handleManualSave = async () => {
        if (!saveName.trim()) return;
        await saveToDb(saveName);
        setSaveName('');
        store.setShowSaveModal(false);
    };

    const handleManualLoad = async (name: string) => {
        await loadFromDb(name);
        store.setShowLoadModal(false);
    };

    const handleDelete = async (name: string) => {
        if (confirm(`Delete ${name}?`)) {
            await deleteSave(name);
        }
    };

    return (
        <>
            {store.showKeyPrompt && <KeyPromptModal onLink={handleKeyLink} />}
            
            {store.isSettingsOpen && (
                <SettingsOverlay 
                    currentModel={store.gameWorld.currentModel}
                    setModel={(m) => store.setGameWorld(prev => ({ ...prev, currentModel: m }))}
                    onClose={() => store.setIsSettingsOpen(false)}
                    onReLink={handleKeyLink} 
                    onExport={handleExport}
                    onImport={handleImport}
                />
            )}
            
            <SaveLoadModal 
                show={store.showSaveModal}
                onClose={() => store.setShowSaveModal(false)}
                mode="save"
                savedGames={saveList}
                onSave={handleManualSave}
                onLoad={() => {}}
                onDelete={handleDelete}
                saveName={saveName}
                setSaveName={setSaveName}
            />
            
            <SaveLoadModal 
                show={store.showLoadModal}
                onClose={() => store.setShowLoadModal(false)}
                mode="load"
                savedGames={saveList}
                onSave={() => {}}
                onLoad={handleManualLoad}
                onDelete={handleDelete}
                saveName=""
                setSaveName={() => {}}
            />

            {store.isGalleryOpen && (
                <GalleryModal 
                    images={store.gameWorld.generatedImages}
                    onClose={() => store.setIsGalleryOpen(false)}
                />
            )}

            {store.isDebugOpen && (
                <DebugModal 
                    onClose={() => store.setIsDebugOpen(false)}
                />
            )}
        </>
    );
};
