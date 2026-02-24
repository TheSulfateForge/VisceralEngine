
import React from 'react';
import { useGameStore } from '../../store';
import { KeyPromptModal } from './KeyPromptModal';
import { SaveLoadModal } from './SaveLoadModal';
import { SettingsOverlay } from './SettingsOverlay';
import { GalleryModal } from './GalleryModal';
import { DebugModal } from './DebugModal';
import { LoreApprovalModal } from './LoreApprovalModal';
import { useGeminiClient } from '../../hooks/useGeminiClient';
import { usePersistence } from '../../hooks/usePersistence';
import { useSavedGames } from '../../hooks/useSavedGames';

export const ModalManager: React.FC = () => {
    const store = useGameStore();
    const { handleKeyLink } = useGeminiClient();
    const { saveToDb, loadFromDb, handleExport, handleImport, handleExportTemplates, handleImportTemplates } = usePersistence();
    const { saveList, deleteSave } = useSavedGames(store.ui.showLoadModal || store.ui.showSaveModal);
    
    // Local state for the save input
    const [saveName, setSaveName] = React.useState('');

    const handleManualSave = async () => {
        if (!saveName.trim()) return;
        await saveToDb(saveName);
        setSaveName('');
        store.setUI({ showSaveModal: false });
    };

    const handleManualLoad = async (name: string) => {
        await loadFromDb(name);
        store.setUI({ showLoadModal: false });
    };

    const handleDelete = async (name: string) => {
        if (confirm(`Delete ${name}?`)) {
            await deleteSave(name);
        }
    };

    return (
        <>
            <LoreApprovalModal />
            
            {store.ui.showKeyPrompt && <KeyPromptModal onLink={handleKeyLink} />}
            
            {store.ui.isSettingsOpen && (
                <SettingsOverlay 
                    currentModel={store.gameWorld.currentModel}
                    setModel={(m) => store.setGameWorld(prev => ({ ...prev, currentModel: m }))}
                    onClose={() => store.setUI({ isSettingsOpen: false })}
                    onReLink={handleKeyLink} 
                    onExport={handleExport}
                    onImport={handleImport}
                    onExportTemplates={handleExportTemplates}
                    onImportTemplates={handleImportTemplates}
                />
            )}
            
            <SaveLoadModal 
                show={store.ui.showSaveModal}
                onClose={() => store.setUI({ showSaveModal: false })}
                mode="save"
                savedGames={saveList}
                onSave={handleManualSave}
                onLoad={() => {}}
                onDelete={handleDelete}
                saveName={saveName}
                setSaveName={setSaveName}
            />
            
            <SaveLoadModal 
                show={store.ui.showLoadModal}
                onClose={() => store.setUI({ showLoadModal: false })}
                mode="load"
                savedGames={saveList}
                onSave={() => {}}
                onLoad={handleManualLoad}
                onDelete={handleDelete}
                saveName=""
                setSaveName={() => {}}
            />

            {store.ui.isGalleryOpen && (
                <GalleryModal 
                    images={store.gameWorld.generatedImages}
                    onClose={() => store.setUI({ isGalleryOpen: false })}
                />
            )}

            {store.ui.isDebugOpen && (
                <DebugModal 
                    onClose={() => store.setUI({ isDebugOpen: false })}
                />
            )}
        </>
    );
};
