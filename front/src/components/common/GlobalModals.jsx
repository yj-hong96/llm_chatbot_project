// src/components/common/GlobalModals.jsx
import React, { useEffect } from "react";
import { formatDateTime } from "../../utils/chatUtils";

function GlobalModals({
  // 검색 모달 Props
  isSearchModalOpen,
  chatSearch,
  onSearchChange,
  searchResults,
  onSearchResultClick,
  onCloseSearch,

  // 메뉴 Props
  menuOpenId,
  menuPosition,
  onMenuAction, // (action, id) => void
  menuInFolder,
  folderMenuOpenId,
  folderMenuPosition,
  onFolderMenuAction, // (action, id) => void

  // 삭제 확인 모달 Props
  confirmDelete, // { id, title }
  onDeleteConfirm,
  onCancelDelete,
  confirmFolderDelete, // { id, name }
  onDeleteFolderConfirm,
  onCancelFolderDelete,

  // 생성/변경 모달 Props
  folderCreateModalOpen,
  newFolderName,
  onNewFolderNameChange,
  onCreateFolderConfirm,
  onCancelCreateFolder,

  renameInfo, // { id, value }
  onRenameChange,
  onRenameConfirm,
  onCancelRename,

  folderRenameInfo, // { id, value }
  onFolderRenameChange,
  onFolderRenameConfirm,
  onCancelFolderRename,

  // 상세정보 & 에러 & 토스트
  detailsModalChat,
  onCloseDetails,
  folders, // 폴더 이름 조회용
  errorInfo,
  onCloseError,
  onOpenErrorDetail,
  copyToastVisible,
  onCloseCopyToast
}) {

  // ✨ [추가] 복사 모달이 떠 있을 때 Enter 키로 닫기
  useEffect(() => {
    if (!copyToastVisible) return;

    const handleEnterKey = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onCloseCopyToast();
      }
    };

    window.addEventListener("keydown", handleEnterKey);
    return () => window.removeEventListener("keydown", handleEnterKey);
  }, [copyToastVisible, onCloseCopyToast]);

  return (
    <>
      {/* 1. 검색 모달 */}
      {isSearchModalOpen && (
        <div className="search-modal-overlay" onClick={onCloseSearch}>
          <div className="search-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="search-modal-header">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#999"
                strokeWidth="2"
                style={{ marginRight: 8 }}
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input 
                 className="search-modal-input" 
                 autoFocus 
                 placeholder="채팅 검색..." 
                 value={chatSearch} 
                 onChange={onSearchChange} 
              />
              <button className="search-modal-close" onClick={onCloseSearch}>✕</button>
            </div>
            <div className="search-modal-results">
              {searchResults.length === 0 ? (
                <div className="search-empty-state">
                  {chatSearch ? "검색 결과가 없습니다." : "검색어를 입력하세요."}
                </div>
              ) : (
                searchResults.map((conv) => (
                  <div key={conv.id} className="search-result-item" onClick={() => onSearchResultClick(conv.id)}>
                    <div className="search-result-icon">💬</div>
                    <div className="search-result-text">{conv.title}</div>
                    <div className="search-result-date">{formatDateTime(conv.updatedAt)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. 채팅 더보기 메뉴 */}
      {menuOpenId && menuPosition && (
        <div 
          className="sidebar-chat-menu" 
          style={{ top: menuPosition.y, left: menuPosition.x }} 
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => onMenuAction("details", menuOpenId)}>상세 정보</button>
          <button onClick={() => onMenuAction("rename", menuOpenId)}>이름 변경하기</button>
          {menuInFolder && <button onClick={() => onMenuAction("moveToRoot", menuOpenId)}>채팅 목록으로 이동</button>}
          <button onClick={() => onMenuAction("delete", menuOpenId)}>대화 삭제</button>
        </div>
      )}

      {/* 3. 폴더 더보기 메뉴 */}
      {folderMenuOpenId && folderMenuPosition && (
        <div 
          className="sidebar-chat-menu" 
          style={{ top: folderMenuPosition.y, left: folderMenuPosition.x }} 
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => onFolderMenuAction("rename", folderMenuOpenId)}>폴더 이름 변경</button>
          <button onClick={() => onFolderMenuAction("delete", folderMenuOpenId)}>폴더 삭제</button>
        </div>
      )}

      {/* 4. 상세 정보 모달 */}
      {detailsModalChat && (
        <div 
          className="error-modal-overlay" 
          onClick={(e) => {
            if (e.target.classList.contains("error-modal-overlay")) {
              onCloseDetails();
            }
          }}
        >
           <div className="details-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="error-modal-header">
                 <span className="error-modal-title">대화 상세 정보</span>
                 <button className="error-modal-close" onClick={onCloseDetails} aria-label="닫기">✕</button>
              </div>
              
              <div>
                <div className="details-section-title">기본 정보</div>
                <div className="details-grid">
                    <span className="details-label">제목</span>
                    <span className="details-value">{detailsModalChat.title}</span>
                    
                    <span className="details-label">생성일</span>
                    <span className="details-value">{formatDateTime(detailsModalChat.createdAt)}</span>
                    
                    <span className="details-label">마지막 활동</span>
                    <span className="details-value">{formatDateTime(detailsModalChat.updatedAt)}</span>
                    
                    <span className="details-label">ID</span>
                    <span className="details-value">{detailsModalChat.id}</span>
                    
                    <span className="details-label">메시지 수</span>
                    <span className="details-value">{detailsModalChat.messages?.length || 0}개</span>
                    
                    {detailsModalChat.folderId && (
                        <>
                          <span className="details-label">폴더</span>
                          <span className="details-value">
                            {folders.find(f => f.id === detailsModalChat.folderId)?.name || "삭제된 폴더"}
                          </span>
                        </>
                    )}
                </div>
              </div>

              <div>
                <div className="details-section-title">대화 전체 내용</div>
                <div className="details-preview-box">
                    {detailsModalChat.messages && detailsModalChat.messages.length > 0 ? (
                        detailsModalChat.messages.map((msg, index) => (
                            <div key={index} style={{marginBottom: "6px"}}>
                                <strong style={{ marginRight: "4px" }}>
                                  {msg.role === "user" ? "👤 나" : "🤖 AI"}:
                                </strong>
                                <span>{msg.text}</span>
                            </div>
                        ))
                    ) : (
                        "(대화 내용 없음)"
                    )}
                </div>
              </div>

              <div className="error-modal-footer">
                  <button className="error-modal-secondary" onClick={onCloseDetails}>닫기</button>
              </div>
           </div>
        </div>
      )}

      {/* 5. 대화 삭제 확인 모달 */}
      {confirmDelete && (
         <div 
           className="error-modal-overlay"
           onClick={(e) => {
             if (e.target.classList.contains("error-modal-overlay")) {
               onCancelDelete();
             }
           }}
         >
             <div className="error-modal" role="dialog" aria-modal="true">
                 <div className="error-modal-header">
                   <span className="error-modal-title">대화 삭제</span>
                 </div>
                 <div className="error-modal-body">
                     <p className="error-modal-guide">이 대화를 정말 삭제하시겠습니까? 삭제하면 되돌릴 수 없습니다.</p>
                     <p className="error-modal-hint">대화 제목: {confirmDelete.title || "제목 없음"}</p>
                 </div>
                 <div className="error-modal-footer">
                     <button className="error-modal-secondary" onClick={onCancelDelete}>아니요</button>
                     <button className="error-modal-primary" onClick={onDeleteConfirm}>예</button>
                 </div>
             </div>
         </div>
      )}

      {/* 6. 폴더 삭제 확인 모달 */}
      {confirmFolderDelete && (
         <div 
           className="error-modal-overlay"
           onClick={(e) => {
             if (e.target.classList.contains("error-modal-overlay")) {
               onCancelFolderDelete();
             }
           }}
         >
             <div className="error-modal" role="dialog" aria-modal="true">
                 <div className="error-modal-header">
                   <span className="error-modal-title">폴더 삭제</span>
                 </div>
                 <div className="error-modal-body">
                     <p className="error-modal-guide">이 폴더를 정말 삭제하시겠습니까? 폴더 안의 채팅은 삭제되지 않고 아래 "채팅" 목록으로 이동합니다.</p>
                     <p className="error-modal-hint">폴더 이름: {confirmFolderDelete.name || "이름 없음"}</p>
                 </div>
                 <div className="error-modal-footer">
                     <button className="error-modal-secondary" onClick={onCancelFolderDelete}>아니요</button>
                     <button className="error-modal-primary" onClick={onDeleteFolderConfirm}>예</button>
                 </div>
             </div>
         </div>
      )}

      {/* 7. 새 폴더 생성 모달 */}
      {folderCreateModalOpen && (
          <div className="error-modal-overlay">
              <div className="error-modal" role="dialog" aria-modal="true">
                  <div className="error-modal-header">
                    <span className="error-modal-title">새 폴더 만들기</span>
                  </div>
                  <div className="error-modal-body">
                      <p className="error-modal-guide">새 폴더의 이름을 입력해 주세요.</p>
                      <input 
                        type="text"
                        className="modal-input" 
                        autoFocus 
                        value={newFolderName} 
                        onChange={onNewFolderNameChange} 
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            onCreateFolderConfirm();
                          }
                        }} 
                      />
                  </div>
                  <div className="error-modal-footer">
                      <button className="error-modal-secondary" onClick={onCancelCreateFolder}>취소</button>
                      <button className="error-modal-primary" onClick={onCreateFolderConfirm}>생성</button>
                  </div>
              </div>
          </div>
      )}

      {/* 8. 대화 이름 변경 모달 */}
      {renameInfo && (
          <div className="error-modal-overlay">
              <div className="error-modal" role="dialog" aria-modal="true">
                  <div className="error-modal-header">
                    <span className="error-modal-title">대화 이름 변경</span>
                  </div>
                  <div className="error-modal-body">
                      <p className="error-modal-guide">대화의 새로운 제목을 입력해 주세요.</p>
                      <input 
                        type="text"
                        className="modal-input" 
                        autoFocus 
                        value={renameInfo.value} 
                        onChange={onRenameChange} 
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault(); 
                            onRenameConfirm();
                          }
                        }} 
                      />
                  </div>
                  <div className="error-modal-footer">
                      <button className="error-modal-secondary" onClick={onCancelRename}>취소</button>
                      <button className="error-modal-primary" onClick={onRenameConfirm}>변경</button>
                  </div>
              </div>
          </div>
      )}

      {/* 9. 폴더 이름 변경 모달 */}
      {folderRenameInfo && (
          <div className="error-modal-overlay">
              <div className="error-modal" role="dialog" aria-modal="true">
                  <div className="error-modal-header">
                    <span className="error-modal-title">폴더 이름 변경</span>
                  </div>
                  <div className="error-modal-body">
                      <p className="error-modal-guide">폴더의 새로운 이름을 입력해 주세요.</p>
                      <input 
                        type="text"
                        className="modal-input" 
                        autoFocus 
                        value={folderRenameInfo.value} 
                        onChange={onFolderRenameChange} 
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            onFolderRenameConfirm();
                          }
                        }} 
                      />
                  </div>
                  <div className="error-modal-footer">
                      <button className="error-modal-secondary" onClick={onCancelFolderRename}>취소</button>
                      <button className="error-modal-primary" onClick={onFolderRenameConfirm}>변경</button>
                  </div>
              </div>
          </div>
      )}

      {/* 10. 에러 모달 */}
      {errorInfo && (
        <div 
          className="error-modal-overlay" 
          onClick={(e) => {
             if (e.target.classList.contains("error-modal-overlay")) {
               onCloseError();
             }
          }}
        >
            <div className="error-modal" role="dialog" aria-modal="true">
                <div className="error-modal-header">
                    <span className="error-modal-title">{errorInfo.title}</span>
                    <button className="error-modal-close" onClick={onCloseError} aria-label="오류창 닫기">✕</button>
                </div>
                <div className="error-modal-body">
                    <p className="error-modal-guide">{errorInfo.guide}</p>
                    <p className="error-modal-hint">{errorInfo.hint}</p>
                </div>
                <div className="error-modal-footer">
                    <button className="error-modal-secondary" onClick={onCloseError}>닫기</button>
                    {onOpenErrorDetail && (
                      <button className="error-modal-primary" onClick={onOpenErrorDetail}>
                        원본 오류 상세 새 창에서 보기
                      </button>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* 11. 복사 알림 토스트 (이제 Enter로 닫힘) */}
      {copyToastVisible && (
          <div 
            className="copy-modal-overlay" 
            onClick={onCloseCopyToast}
          >
              <div className="copy-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="copy-modal-body">복사되었습니다.</div>
                  <div className="copy-modal-footer">
                    <button className="copy-modal-button" onClick={onCloseCopyToast}>
                      확인
                    </button>
                  </div>
              </div>
          </div>
      )}
    </>
  );
}

export default GlobalModals;