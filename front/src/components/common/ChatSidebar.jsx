// src/components/common/ChatSidebar.jsx
import React, { useRef, useState, useEffect } from "react";
import { autoScroll } from "../../utils/chatUtils";

// 드래그 헬퍼
function getDraggedChatId(e) {
  return e.dataTransfer.getData("text/plain") || "";
}
function getDraggedFolderId(e) {
  return e.dataTransfer.getData("text/plain") || "";
}

function ChatSidebar({
  // 상태 Props
  sidebarOpen,
  sidebarCollapsed,
  setSidebarCollapsed,
  folders,
  conversations,
  currentId,
  selectedFolderId,
  loading,
  pendingConvId,
  
  // 액션 핸들러 Props
  onNewChat,
  onSelectConversation,
  onSelectFolder,
  onCreateFolder,
  onToggleFolder,
  isFolderCollapsed,
  
  // 메뉴/드래그 관련 Props (부모에서 제어하는 상태들)
  menuOpenId,
  setMenuOpenId,
  setMenuPosition,
  setMenuInFolder,
  setFolderMenuOpenId,
  setFolderMenuPosition,
  
  // 드래그 핸들러 (페이지에서 로직을 넘겨받음)
  dragHandlers
}) {
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const sidebarResizeRef = useRef(null);
  const folderChatsRefs = useRef({});
  const rootListRef = useRef(null);

  // 로컬 드래그 상태 (UI 표시용)
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [folderDraggingId, setFolderDraggingId] = useState(null);
  const [folderDragOverId, setFolderDragOverId] = useState(null);

  // 사이드바 리사이즈 로직
  useEffect(() => {
    if (!isResizingSidebar) return;
    const handleMouseMove = (e) => {
      const data = sidebarResizeRef.current;
      if (!data) return;
      const delta = e.clientX - data.startX;
      let nextWidth = data.startWidth + delta;
      if (nextWidth < 180) nextWidth = 180;
      if (nextWidth > 360) nextWidth = 360;
      setSidebarWidth(nextWidth);
    };
    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      sidebarResizeRef.current = null;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar]);

  const handleSidebarResizeMouseDown = (e) => {
    if (sidebarCollapsed) return;
    e.preventDefault();
    sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    setIsResizingSidebar(true);
  };

  // 헬퍼: 드래그 핸들러 래퍼 (부모 핸들러 호출 + 로컬 상태 업데이트)
  const onDragStart = (e, id) => {
      setDraggingId(id);
      dragHandlers.handleDragStart(e, id);
  }
  const onDragEnd = () => {
      setDraggingId(null); setDragOverId(null); setDragOverFolderId(null);
      setFolderDraggingId(null); setFolderDragOverId(null);
      dragHandlers.handleDragEnd();
  }

  // 데이터 필터링
  const rootConversations = conversations.filter((c) => !c.folderId);

  return (
    <aside
      className={"chat-sidebar" + (sidebarCollapsed ? " collapsed" : "") + (sidebarOpen ? " open" : "")}
      style={!sidebarCollapsed ? { flex: `0 0 ${sidebarWidth}px` } : undefined}
    >
      <div className="sidebar-top">
        <button className="sidebar-menu-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
           <img src="/img/menu.png" alt="사이드바" />
        </button>
        {!sidebarCollapsed && <button className="sidebar-new-chat-btn" onClick={onNewChat}>새 채팅</button>}
      </div>

      {!sidebarCollapsed && (
        <>
          {/* 검색 트리거는 부모에서 처리하거나 여기서 처리. 일단 간소화를 위해 부모 모달 호출 버튼만 둠 */}
          <button className="sidebar-search-trigger" onClick={dragHandlers.onOpenSearch}>
             🔍 채팅 검색
          </button>

          {/* 폴더 섹션 */}
          <div className="sidebar-section-title">폴더</div>
          <div className="sidebar-folder-list" onMouseDown={() => dragHandlers.setFocusArea("folder")}>
             {/* 폴더 목록 렌더링 로직 (기존 코드의 map 부분) */}
             {folders.map(folder => {
                 const childConvs = conversations.filter(c => c.folderId === folder.id);
                 const collapsed = isFolderCollapsed(folder.id);
                 
                 return (
                     <div key={folder.id} 
                          className={`sidebar-folder-item ${selectedFolderId === folder.id ? 'selected' : ''}`}
                          onClick={() => onSelectFolder(folder.id)}
                          draggable
                          onDragStart={(e) => {
                              setFolderDraggingId(folder.id);
                              dragHandlers.handleFolderItemDragStart(e, folder.id);
                          }}
                          onDragOver={(e) => {
                             e.preventDefault();
                             setDragOverFolderId(folder.id);
                             // 부모 핸들러 호출 가능하면 호출
                          }}
                          onDrop={(e) => dragHandlers.handleFolderDrop(e, folder.id)}
                          onDragEnd={onDragEnd}
                     >
                         <div className="sidebar-folder-header">
                             <button className="sidebar-folder-toggle" onClick={(e) => { e.stopPropagation(); onToggleFolder(folder.id); }}>
                                 {collapsed ? "+" : "−"}
                             </button>
                             <span className="sidebar-folder-name">{folder.name}</span>
                             <div className="sidebar-folder-controls">
                                 {childConvs.length > 0 && <span className="sidebar-folder-count">{childConvs.length}</span>}
                                 <button className="sidebar-chat-more" onClick={(e) => {
                                     e.stopPropagation();
                                     const rect = e.currentTarget.getBoundingClientRect();
                                     setFolderMenuPosition({ x: rect.right, y: rect.bottom + 4 });
                                     setFolderMenuOpenId(folder.id);
                                     setMenuOpenId(null);
                                 }}>⋯</button>
                             </div>
                         </div>
                         
                         {/* 폴더 내 채팅 목록 */}
                         {!collapsed && childConvs.length > 0 && (
                            <div className="sidebar-folder-chats">
                                {childConvs.map(conv => (
                                    <div key={conv.id} className="sidebar-folder-chat-row"
                                         draggable
                                         onDragStart={(e) => onDragStart(e, conv.id)}
                                         onDrop={(e) => dragHandlers.handleDropOnFolderChat(e, conv.id, folder.id)}
                                         onDragOver={(e) => { e.preventDefault(); setDragOverId(conv.id); }}
                                         onDragEnd={onDragEnd}
                                    >
                                        <button className={`sidebar-folder-chat ${conv.id === currentId ? 'active' : ''}`}
                                                onClick={() => onSelectConversation(conv.id)}>
                                            {conv.title}
                                            {loading && pendingConvId === conv.id && "..."}
                                        </button>
                                        <button className="sidebar-chat-more" onClick={(e) => {
                                            e.stopPropagation();
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setMenuPosition({ x: rect.right, y: rect.bottom + 4 });
                                            setMenuOpenId(conv.id);
                                            setMenuInFolder(true);
                                        }}>⋯</button>
                                    </div>
                                ))}
                            </div>
                         )}
                         {/* 빈 폴더 드롭 영역 */}
                         {childConvs.length === 0 && (
                             <div className="sidebar-folder-empty-drop" 
                                  onDrop={(e) => dragHandlers.handleDropChatOnFolderHeader(e, folder.id)}
                                  onDragOver={(e) => { e.preventDefault(); setDragOverFolderId(folder.id); }}>
                                  여기로 드롭
                             </div>
                         )}
                     </div>
                 )
             })}
             <button className="sidebar-new-folder-btn" onClick={onCreateFolder}>+ 새 폴더</button>
          </div>

          {/* 채팅 섹션 (Root) */}
          <div className="sidebar-chat-section" 
               onDragOver={(e) => { e.preventDefault(); autoScroll(rootListRef.current, e.clientY); }}
               onDrop={dragHandlers.handleRootListDrop}>
             <div className="sidebar-section-title">채팅</div>
             <div className="sidebar-chat-list" ref={rootListRef}>
                 {rootConversations.map((conv, idx) => (
                     <div key={conv.id} className={`sidebar-chat-item ${conv.id === currentId ? 'active' : ''}`}
                          draggable
                          onDragStart={(e) => onDragStart(e, conv.id)}
                          onDragOver={(e) => { e.preventDefault(); setDragOverId(conv.id); }}
                          onDrop={(e) => dragHandlers.handleDropOnRootItem(e, conv.id)}
                          onDragEnd={onDragEnd}
                          onClick={() => onSelectConversation(conv.id)}
                     >
                         <div className="sidebar-chat-main">
                             <span className="sidebar-chat-index">{idx + 1}</span>
                             <span className="sidebar-chat-title">{conv.title}</span>
                             {loading && pendingConvId === conv.id && "..."}
                         </div>
                         <button className="sidebar-chat-more" onClick={(e) => {
                             e.stopPropagation();
                             const rect = e.currentTarget.getBoundingClientRect();
                             setMenuPosition({ x: rect.right, y: rect.bottom + 4 });
                             setMenuOpenId(conv.id);
                             setMenuInFolder(false);
                         }}>⋯</button>
                     </div>
                 ))}
             </div>
          </div>
        </>
      )}
      {!sidebarCollapsed && <div className="sidebar-resize-handle" onMouseDown={handleSidebarResizeMouseDown} />}
    </aside>
  );
}

export default ChatSidebar;