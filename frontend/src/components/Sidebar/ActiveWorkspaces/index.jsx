import React, { useState, useEffect } from "react";
import * as Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import Workspace from "@/models/workspace";
import System from "@/models/system";
import ManageWorkspace, {
  useManageWorkspaceModal,
} from "../../Modals/ManageWorkspace";
import paths from "@/utils/paths";
import { Link, useParams, useNavigate, useMatch } from "react-router-dom";
import {
  GearSix,
  UploadSimple,
  DotsSixVertical,
  CaretDown,
  FolderNotch,
  Plus,
} from "@phosphor-icons/react";
import useUser from "@/hooks/useUser";
import ThreadContainer from "./ThreadContainer";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import showToast from "@/utils/toast";
import { LAST_VISITED_WORKSPACE } from "@/utils/constants";
import { safeJsonParse } from "@/utils/request";
import { useTranslation } from "react-i18next";
import WorkspaceFolderTree from "@/components/FolderSidebar/WorkspaceFolderTree";
import RecentFilesSection from "@/components/FolderSidebar/RecentFilesSection";
import { flattenWorkspaceDocuments } from "@/utils/workspaceDocumentsTree";
import {
  addRecentProjectFile,
  getRecentProjectFiles,
} from "@/utils/recentProjectFiles";
import {
  DocumentContextAction,
  buildDocumentContextPayload,
  dispatchDocumentContextAction,
  stashPendingDocumentContext,
} from "@/utils/documentContext";

export default function ActiveWorkspaces({ showNewWsModal }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { slug } = useParams();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWs, setSelectedWs] = useState(null);
  const [expandedSlug, setExpandedSlug] = useState(null);
  const [filesCache, setFilesCache] = useState({});
  const [loadingTree, setLoadingTree] = useState({});
  const [docCounts, setDocCounts] = useState({});
  const [recentFiles, setRecentFiles] = useState(() => getRecentProjectFiles());
  const { showing, showModal, hideModal } = useManageWorkspaceModal();
  const { user } = useUser();
  const isInWorkspaceSettings = !!useMatch("/workspace/:slug/settings/:tab");
  const isHomePage = !!useMatch("/");

  useEffect(() => {
    async function getWorkspaces() {
      const workspaces = await Workspace.all();
      setLoading(false);
      setWorkspaces(Workspace.orderWorkspaces(workspaces));
    }
    getWorkspaces();
  }, []);

  useEffect(() => {
    if (!workspaces.length) return;

    let cancelled = false;

    async function loadDocCounts() {
      const entries = await Promise.all(
        workspaces.map(async (ws) => {
          const full = await Workspace.bySlug(ws.slug);
          return [ws.slug, full?.documents?.length ?? 0];
        })
      );
      if (!cancelled) {
        setDocCounts(Object.fromEntries(entries));
      }
    }

    loadDocCounts();
    return () => {
      cancelled = true;
    };
  }, [workspaces]);

  async function toggleTreeExpand(wsSlug, event) {
    event.preventDefault();
    event.stopPropagation();

    if (expandedSlug === wsSlug) {
      setExpandedSlug(null);
      return;
    }

    setExpandedSlug(wsSlug);

    if (filesCache[wsSlug]) return;

    setLoadingTree((prev) => ({ ...prev, [wsSlug]: true }));
    try {
      const [workspace, localFiles] = await Promise.all([
        Workspace.bySlug(wsSlug),
        System.localFiles(),
      ]);
      const docpaths = workspace?.documents?.map((doc) => doc.docpath) ?? [];
      const files = flattenWorkspaceDocuments(
        localFiles,
        workspace?.documents || []
      );
      setFilesCache((prev) => ({ ...prev, [wsSlug]: files }));
      setDocCounts((prev) => ({ ...prev, [wsSlug]: docpaths.length }));
    } catch (error) {
      console.error(error);
      showToast(t("projects.load_failed"), "error");
    } finally {
      setLoadingTree((prev) => ({ ...prev, [wsSlug]: false }));
    }
  }

  function handleFileOpen(file, workspace) {
    const document = file.docId
      ? {
          docId: file.docId,
          filename: file.filename || file.name,
          label: file.label || file.title || file.name,
          mentionType: file.mentionType || "document",
        }
      : null;
    const updated = addRecentProjectFile({
      title: file.title,
      docpath: file.docpath,
      docId: file.docId,
      filename: file.filename || file.name,
      label: file.label || file.title || file.name,
      mentionType: file.mentionType || "document",
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      extension: file.extension,
    });
    setRecentFiles(updated);

    const contextPayload = document
      ? buildDocumentContextPayload({
          action: DocumentContextAction.ASK,
          workspaceSlug: workspace.slug,
          document,
        })
      : null;

    if (slug !== workspace.slug) {
      if (contextPayload) stashPendingDocumentContext(contextPayload);
      navigate(paths.workspace.chat(workspace.slug));
    } else if (contextPayload) {
      dispatchDocumentContextAction(contextPayload);
    }
  }

  if (loading) {
    return (
      <Skeleton.default
        height={40}
        width="100%"
        count={5}
        baseColor="var(--theme-sidebar-item-default)"
        highlightColor="var(--theme-sidebar-item-hover)"
        enableAnimation={true}
        className="my-1"
      />
    );
  }

  function reorderWorkspaces(startIndex, endIndex) {
    const reorderedWorkspaces = Array.from(workspaces);
    const [removed] = reorderedWorkspaces.splice(startIndex, 1);
    reorderedWorkspaces.splice(endIndex, 0, removed);
    setWorkspaces(reorderedWorkspaces);
    const success = Workspace.storeWorkspaceOrder(
      reorderedWorkspaces.map((w) => w.id)
    );
    if (!success) {
      showToast("Failed to reorder workspaces", "error");
      Workspace.all().then((workspaces) => setWorkspaces(workspaces));
    }
  }

  const onDragEnd = (result) => {
    if (!result.destination) return;
    reorderWorkspaces(result.source.index, result.destination.index);
  };

  const virtualActiveSlug = (() => {
    if (!isHomePage || workspaces.length === 0) return null;
    const lastVisited = safeJsonParse(
      localStorage.getItem(LAST_VISITED_WORKSPACE)
    );
    if (
      lastVisited?.slug &&
      workspaces.some((ws) => ws.slug === lastVisited.slug)
    )
      return lastVisited.slug;
    return workspaces[0]?.slug ?? null;
  })();

  const activeSlug = slug || virtualActiveSlug;
  const activeWorkspace = workspaces.find((ws) => ws.slug === activeSlug);

  const canCreateProject = !user || user?.role !== "default";

  return (
    <div className="flex flex-col gap-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-secondary px-1">
        {t("projects.title")}
      </p>

      {canCreateProject && showNewWsModal && (
        <button
          type="button"
          onClick={showNewWsModal}
          className="flex w-full h-[32px] gap-x-2 py-1 px-3 mb-1 bg-white/10 light:bg-white rounded-lg text-sidebar justify-center items-center hover:bg-white/20 light:hover:bg-slate-100 transition-all duration-200 border-none"
        >
          <Plus className="h-4 w-4" weight="bold" />
          <span className="text-sidebar light:text-slate-800 text-xs font-semibold">
            {t("projects.new_project")}
          </span>
        </button>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="workspaces">
          {(provided) => (
            <div
              role="list"
              aria-label={t("projects.title")}
              className="flex flex-col gap-y-2"
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {workspaces.map((workspace, index) => {
                const isVirtuallyActive = workspace.slug === virtualActiveSlug;
                const isActive = workspace.slug === slug || isVirtuallyActive;
                const isTreeExpanded = expandedSlug === workspace.slug;
                const docCount = docCounts[workspace.slug] ?? 0;

                return (
                  <Draggable
                    key={workspace.id}
                    draggableId={workspace.id.toString()}
                    index={index}
                  >
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`flex flex-col w-full group ${
                          snapshot.isDragging ? "opacity-50" : ""
                        }`}
                        role="listitem"
                      >
                        <div className="flex gap-x-1 items-stretch justify-between">
                          <button
                            type="button"
                            onClick={(e) => toggleTreeExpand(workspace.slug, e)}
                            aria-expanded={isTreeExpanded}
                            aria-label={t("projects.toggle_tree")}
                            className="shrink-0 flex items-center justify-center w-5 border-none bg-transparent p-0 cursor-pointer text-theme-text-secondary hover:text-white light:hover:text-slate-900"
                          >
                            <CaretDown
                              size={12}
                              weight="bold"
                              className={`transition-transform duration-200 ${
                                isTreeExpanded ? "" : "-rotate-90"
                              }`}
                            />
                          </button>

                          <Link
                            to={paths.workspace.chat(workspace.slug)}
                            aria-current={isActive ? "page" : ""}
                            className={`
                            transition-all duration-[200ms]
                            flex flex-grow min-w-0 gap-x-1 py-[6px] pl-[2px] pr-[6px] rounded-[4px] text-white justify-start items-center
                            bg-theme-sidebar-item-default
                            ${isActive ? "light:bg-blue-200 font-bold" : "hover:bg-theme-sidebar-subitem-hover light:hover:bg-slate-300"}
                          `}
                          >
                            <div className="flex flex-row justify-between w-full items-center min-w-0">
                              <div
                                {...provided.dragHandleProps}
                                className="cursor-grab mr-[2px] shrink-0"
                              >
                                <DotsSixVertical
                                  size={18}
                                  className={`${isActive ? "text-white light:text-blue-800" : ""}`}
                                  weight="bold"
                                />
                              </div>
                              <FolderNotch
                                size={16}
                                weight="fill"
                                className={`shrink-0 mr-1 ${isActive ? "text-white light:text-blue-800" : "text-theme-text-secondary"}`}
                              />
                              <div
                                data-tooltip-id="workspace-name"
                                data-tooltip-content={workspace.name}
                                className="flex items-center min-w-0 flex-grow gap-x-1"
                              >
                                <p
                                  className={`
                                  text-[13px] leading-snug whitespace-nowrap overflow-hidden truncate
                                  ${isActive ? "font-bold text-white light:text-blue-900" : "font-medium"}
                                `}
                                >
                                  {workspace.name}
                                </p>
                                <span
                                  className={`text-[10px] shrink-0 ${
                                    isActive
                                      ? "text-white/70 light:text-blue-700"
                                      : "text-theme-text-secondary"
                                  }`}
                                >
                                  {t("projects.file_count", { count: docCount })}
                                </span>
                              </div>
                              {user?.role !== "default" && (
                                <div
                                  className={`flex items-center gap-x-[2px] shrink-0 transition-opacity duration-200 ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setSelectedWs(workspace);
                                      showModal();
                                    }}
                                    data-tooltip-id="upload-workspace"
                                    data-tooltip-content="Upload documents to this workspace for RAG indexing"
                                    className={`group/upload border-none rounded-md flex items-center justify-center ml-auto p-[2px] ${isActive ? "hover:bg-zinc-500 light:hover:bg-sky-800/30" : "hover:bg-zinc-500 light:hover:bg-slate-400"}`}
                                  >
                                    <UploadSimple
                                      className={`h-[18px] w-[18px] ${isActive ? "text-zinc-400 hover:text-white light:text-blue-700 light:group-hover/upload:text-blue-900" : "text-zinc-400 hover:text-white light:text-slate-600 light:group-hover/upload:text-slate-950"}`}
                                    />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      navigate(
                                        isInWorkspaceSettings
                                          ? paths.workspace.chat(workspace.slug)
                                          : paths.workspace.settings.generalAppearance(
                                              workspace.slug
                                            )
                                      );
                                    }}
                                    className={`group/gear rounded-md flex items-center justify-center ml-auto p-[2px] ${isActive ? "hover:bg-zinc-500 light:hover:bg-sky-800/30" : "hover:bg-zinc-500 light:hover:bg-slate-400"}`}
                                    aria-label="General appearance settings"
                                    data-tooltip-id="gear-workspace"
                                    data-tooltip-content="General appearance settings"
                                  >
                                    <GearSix
                                      color={
                                        isInWorkspaceSettings &&
                                        workspace.slug === slug
                                          ? "#46C8FF"
                                          : undefined
                                      }
                                      className={`h-[18px] w-[18px] ${isActive ? "text-zinc-400 hover:text-white light:text-blue-700 light:group-hover/gear:text-blue-900" : "text-zinc-400 hover:text-white light:text-slate-600 light:group-hover/gear:text-slate-950"}`}
                                    />
                                  </button>
                                </div>
                              )}
                            </div>
                          </Link>
                        </div>

                        {isTreeExpanded && (
                          <WorkspaceFolderTree
                            files={filesCache[workspace.slug]}
                            loading={loadingTree[workspace.slug]}
                            workspaceSlug={workspace.slug}
                            onFileClick={(file) => handleFileOpen(file, workspace)}
                          />
                        )}
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
              {showing && (
                <ManageWorkspace
                  hideModal={hideModal}
                  providedSlug={selectedWs ? selectedWs.slug : null}
                />
              )}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {activeWorkspace && (
        <div className="flex flex-col gap-y-1 mt-2 pt-2 border-t border-white/10">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-secondary px-1">
            {t("chats.title")}
          </p>
          <ThreadContainer
            workspace={activeWorkspace}
            isVirtualThread={activeWorkspace.slug === virtualActiveSlug && !slug}
          />
        </div>
      )}

      <RecentFilesSection
        recentFiles={recentFiles}
        onRecentFilesChange={setRecentFiles}
      />
    </div>
  );
}
