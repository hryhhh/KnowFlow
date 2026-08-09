import { Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./components/MainLayout";
import DashboardPage from "./pages/Dashboard/DashboardPage";
import KnowledgeBaseList from "./pages/KnowledgeBase/KnowledgeBaseList";
import DocumentList from "./pages/Document/DocumentList";
import ChunkList from "./pages/Chunk/ChunkList";
import KbChunkList from "./pages/Chunk/KbChunkList";
import RetrievalPage from "./pages/Retrieval/RetrievalPage";
import ChatPage from "./pages/Chat/ChatPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="knowledge-bases" element={<KnowledgeBaseList />} />
        <Route
          path="knowledge-bases/:kbId/documents"
          element={<DocumentList />}
        />
        <Route
          path="knowledge-bases/:kbId/documents/:docId/chunks"
          element={<ChunkList />}
        />
        <Route
          path="knowledge-bases/:kbId/chunks"
          element={<KbChunkList />}
        />
        <Route
          path="knowledge-bases/:kbId/retrieval"
          element={<RetrievalPage />}
        />
        <Route path="knowledge-bases/:kbId/chat" element={<ChatPage />} />
      </Route>
    </Routes>
  );
}
