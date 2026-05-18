import { useEffect } from 'react';
import Sidebar from './components/Sidebar.jsx';
import SearchBar from './components/SearchBar.jsx';
import ImageGrid from './components/ImageGrid.jsx';
import ImageModal from './components/ImageModal.jsx';
import { useStore } from './store/useStore';
import { electron } from './hooks/useElectronAPI';

export default function App() {
  const setIndexProgress = useStore(s => s.setIndexProgress);
  const setIndexSummary  = useStore(s => s.setIndexSummary);

  useEffect(() => {
    if (!electron.available) {
      console.warn('Running outside Electron — IPC will not work');
      return;
    }
    const offProg     = electron.on('indexing:progress', (p) => setIndexProgress(p));
    const offComplete = electron.on('indexing:complete', (s) => setIndexSummary(s));
    return () => { offProg && offProg(); offComplete && offComplete(); };
  }, [setIndexProgress, setIndexSummary]);

  return (
    <div className="h-screen w-screen flex bg-bg-base">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <SearchBar />
        <ImageGrid />
      </div>
      <ImageModal />
    </div>
  );
}
