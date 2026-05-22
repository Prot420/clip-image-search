import { create } from 'zustand';

export const useStore = create((set, get) => ({
  folders: [],
  loadingFolders: false,

  indexing: false,
  indexProgress: null,
  indexFolderId: null,
  indexSummary: null,

  query: '',
  results: [],
  searching: false,
  searchMode: 'text',
  activeCategory: null,

  selectedImage: null,
  similarImages: [],

  stats: { totalImages: 0 },

  setFolders: (folders) => set({ folders }),
  setLoadingFolders: (b) => set({ loadingFolders: b }),

  setIndexing: (b)        => set({ indexing: b }),
  setIndexProgress: (p)   => set({ indexProgress: p }),
  setIndexFolderId: (id)  => set({ indexFolderId: id }),
  setIndexSummary: (s)    => set({ indexSummary: s }),

  setQuery:     (q)       => set({ query: q }),
  setResults:   (r)       => set({ results: r, activeCategory: null }),
  setActiveCategory: (c)  => set({ activeCategory: c }),
  setSearching: (b)       => set({ searching: b }),
  setSearchMode:(m)       => set({ searchMode: m }),

  setSelectedImage: (img) => set({ selectedImage: img, similarImages: [] }),
  setSimilarImages: (imgs) => set({ similarImages: imgs }),
  clearSelectedImage: ()  => set({ selectedImage: null, similarImages: [] }),

  setStats: (s) => set({ stats: s })
}));
