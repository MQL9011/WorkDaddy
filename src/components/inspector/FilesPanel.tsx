import {
  ChevronDown,
  ChevronRight,
  Code2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { basename } from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { useI18n } from '@/lib/i18n'
import type { GitStatus, ProjectFileEntry, ProjectRecord } from '@/types/api'
import { EmptyState, IconButton } from '../ui'

export interface FileTreeNode {
  id: string
  name: string
  path: string
  fullPath: string
  root: string
  type: 'directory' | 'file'
  children: FileTreeNode[]
  /** Whether `children` reflects a real fetch. Always true for files; false for a directory not yet expanded. */
  childrenLoaded: boolean
  depth: number
}

export function getFileIcon(filename: string) {
  if (filename.endsWith('.json')) {
    return <FileJson2 size={13} />
  }
  if (
    /\.(tsx?|jsx?|vue|svelte|html|css|scss|py|rs|go|c|cpp|h|java|php|rb|sh|bash|zsh|sql|ya?ml|toml)$/i.test(
      filename,
    )
  ) {
    return <Code2 size={13} />
  }
  return <FileText size={13} />
}

function compareNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
}

export function buildTreeFromEntries(
  entries: ProjectFileEntry[],
  root: string,
  baseDepth = 0,
  /** Whether `entries` is a complete recursive listing (true, e.g. search) vs. a single directory level (false). */
  childrenLoaded = true,
): FileTreeNode[] {
  const rootNodes: FileTreeNode[] = []
  const nodeMap = new Map<string, FileTreeNode>()

  const getOrCreateDir = (dirPath: string): FileTreeNode => {
    const normalized = dirPath.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
    let node = nodeMap.get(normalized)
    if (node) return node

    const lastSlash = normalized.lastIndexOf('/')
    const parentPath = lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
    const name = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)
    const depth = baseDepth + (normalized ? normalized.split('/').length - 1 : 0)

    node = {
      id: `${root}\0${normalized}`,
      name,
      path: normalized,
      fullPath: `${root}/${normalized}`,
      root,
      type: 'directory',
      children: [],
      childrenLoaded,
      depth,
    }
    nodeMap.set(normalized, node)

    if (parentPath) {
      getOrCreateDir(parentPath).children.push(node)
    } else {
      rootNodes.push(node)
    }
    return node
  }

  for (const entry of entries) {
    if (!entry.path) continue
    const normalized = entry.path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
    if (!normalized) continue
    const lastSlash = normalized.lastIndexOf('/')
    const parentPath = lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
    const name = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)
    const depth = baseDepth + (lastSlash === -1 ? 0 : normalized.split('/').length - 1)

    let node = nodeMap.get(normalized)
    if (node) {
      node.type = entry.type
    } else {
      node = {
        id: `${root}\0${normalized}`,
        name,
        path: normalized,
        fullPath: `${root}/${normalized}`,
        root,
        type: entry.type,
        children: [],
        childrenLoaded: entry.type === 'file' ? true : childrenLoaded,
        depth,
      }
      nodeMap.set(normalized, node)

      if (parentPath) {
        getOrCreateDir(parentPath).children.push(node)
      } else {
        rootNodes.push(node)
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort(compareNodes)
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children)
      }
    }
  }

  sortNodes(rootNodes)
  return rootNodes
}

/**
 * Maps one directory's immediate children (from `listDirectory`) to sibling nodes. Unlike
 * `buildTreeFromEntries`, it never fabricates ancestor placeholders — every entry here already
 * shares the same, already-known parent, so there is nothing to reconstruct.
 */
export function mapEntriesToNodes(entries: ProjectFileEntry[], root: string, depth: number): FileTreeNode[] {
  const nodes = entries.map((entry): FileTreeNode => {
    const normalized = entry.path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
    const lastSlash = normalized.lastIndexOf('/')
    const name = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)
    return {
      id: `${root}\0${normalized}`,
      name,
      path: normalized,
      fullPath: `${root}/${normalized}`,
      root,
      type: entry.type,
      children: [],
      childrenLoaded: entry.type === 'file',
      depth,
    }
  })
  nodes.sort(compareNodes)
  return nodes
}

/** Immutably replaces one node's children by id; the rest of the tree is left untouched (same array reference if `targetId` isn't found). */
export function updateNode(
  nodes: FileTreeNode[],
  targetId: string,
  updater: (node: FileTreeNode) => FileTreeNode,
): FileTreeNode[] {
  let changed = false
  const next = nodes.map((node) => {
    if (node.id === targetId) {
      changed = true
      return updater(node)
    }
    if (node.type === 'directory' && node.children.length > 0) {
      const children = updateNode(node.children, targetId, updater)
      if (children !== node.children) {
        changed = true
        return { ...node, children }
      }
    }
    return node
  })
  return changed ? next : nodes
}

export function buildProjectTree(
  groups: Array<{ root: string; listing: { entries: ProjectFileEntry[]; skipped: number } }>,
  _primaryFolder: string,
  /** Whether each group's `entries` is a complete recursive listing (true, e.g. search) vs. a single directory level (false). */
  childrenLoaded = true,
): FileTreeNode[] {
  if (groups.length === 0) return []
  if (groups.length === 1) {
    return buildTreeFromEntries(groups[0].listing.entries, groups[0].root, 0, childrenLoaded)
  }

  return groups.map(({ root, listing }) => ({
    id: root,
    name: basename(root),
    path: '',
    fullPath: root,
    root,
    type: 'directory' as const,
    children: buildTreeFromEntries(listing.entries, root, 1, childrenLoaded),
    childrenLoaded: true,
    depth: 0,
  }))
}

export function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return nodes

  const filterNode = (node: FileTreeNode): FileTreeNode | null => {
    const isMatch =
      node.name.toLowerCase().includes(normalized) || node.path.toLowerCase().includes(normalized)
    if (node.type === 'file') {
      return isMatch ? node : null
    }

    const filteredChildren = node.children
      .map(filterNode)
      .filter((child): child is FileTreeNode => child !== null)

    if (isMatch || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      }
    }
    return null
  }

  return nodes.map(filterNode).filter((node): node is FileTreeNode => node !== null)
}

export function flattenVisibleTree(
  nodes: FileTreeNode[],
  expandedIds: ReadonlySet<string>,
  isSearching: boolean,
): FileTreeNode[] {
  const result: FileTreeNode[] = []
  const traverse = (list: FileTreeNode[]) => {
    for (const node of list) {
      result.push(node)
      if (node.type === 'directory' && node.children.length > 0) {
        const isExpanded = isSearching || expandedIds.has(node.id)
        if (isExpanded) {
          traverse(node.children)
        }
      }
    }
  }
  traverse(nodes)
  return result
}

export function collectDirectoryIds(nodes: FileTreeNode[]): Set<string> {
  const ids = new Set<string>()
  const collect = (list: FileTreeNode[]) => {
    for (const node of list) {
      if (node.type === 'directory') {
        ids.add(node.id)
        collect(node.children)
      }
    }
  }
  collect(nodes)
  return ids
}

export function FilesPanel({
  project,
  git,
  onReveal,
}: {
  project?: ProjectRecord
  git: GitStatus
  onReveal(path: string): void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [treeRoots, setTreeRoots] = useState<FileTreeNode[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [skipped, setSkipped] = useState(0)
  const [visibleLimit, setVisibleLimit] = useState(1_000)
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set())
  const [expandErrors, setExpandErrors] = useState<Map<string, string>>(() => new Map())
  const [searchTree, setSearchTree] = useState<FileTreeNode[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchTruncated, setSearchTruncated] = useState(false)
  const loadToken = useRef(0)

  const load = async () => {
    const token = ++loadToken.current
    setTreeRoots([])
    setExpandedIds(new Set())
    setError('')
    setSkipped(0)
    setVisibleLimit(1_000)
    setLoadingIds(new Set())
    setExpandErrors(new Map())
    setSearchTree(null)
    setSearchError('')
    setSearchTruncated(false)
    setSearchLoading(false)
    if (!project || !window.prime) return
    setLoading(true)
    try {
      const roots = project.folders.length ? project.folders : [project.primaryFolder]
      const groups = await Promise.all(
        roots.map(async (root) => ({
          root,
          listing: await window.prime.projects.listDirectory(root, root, project.harness),
        })),
      )
      if (loadToken.current !== token) return
      setSkipped(groups.reduce((sum, group) => sum + group.listing.skipped, 0))
      const builtTree = buildProjectTree(groups, project.primaryFolder, false)
      setTreeRoots(builtTree)
    } catch (reason) {
      if (loadToken.current === token) setError(errorMessage(reason))
    } finally {
      if (loadToken.current === token) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return () => {
      loadToken.current += 1
    }
  }, [project?.id, project?.primaryFolder, project?.folders.join('\0'), project?.harness])

  const loadChildren = async (node: FileTreeNode) => {
    if (!project || !window.prime) return
    const token = loadToken.current
    setExpandErrors((prev) => {
      if (!prev.has(node.id)) return prev
      const next = new Map(prev)
      next.delete(node.id)
      return next
    })
    setLoadingIds((prev) => new Set(prev).add(node.id))
    try {
      const listing = await window.prime.projects.listDirectory(node.root, node.fullPath, project.harness)
      if (loadToken.current !== token) return
      const children = mapEntriesToNodes(listing.entries, node.root, node.depth + 1)
      setTreeRoots((prev) =>
        updateNode(prev, node.id, (current) => ({ ...current, children, childrenLoaded: true })),
      )
      if (listing.skipped > 0) setSkipped((prev) => prev + listing.skipped)
    } catch (reason) {
      if (loadToken.current !== token) return
      setExpandErrors((prev) => new Map(prev).set(node.id, errorMessage(reason)))
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.delete(node.id)
        return next
      })
    } finally {
      if (loadToken.current === token) {
        setLoadingIds((prev) => {
          const next = new Set(prev)
          next.delete(node.id)
          return next
        })
      }
    }
  }

  const loadSearchTree = async () => {
    if (!project || !window.prime) return
    const token = loadToken.current
    setSearchLoading(true)
    setSearchError('')
    try {
      const roots = project.folders.length ? project.folders : [project.primaryFolder]
      const groups = await Promise.all(
        roots.map(async (root) => ({
          root,
          listing: await window.prime.projects.listFiles(root, project.harness),
        })),
      )
      if (loadToken.current !== token) return
      setSearchTruncated(groups.some((group) => group.listing.truncated))
      setSearchTree(buildProjectTree(groups, project.primaryFolder))
    } catch (reason) {
      if (loadToken.current === token) setSearchError(errorMessage(reason))
    } finally {
      if (loadToken.current === token) setSearchLoading(false)
    }
  }

  const changed = useMemo(
    () => new Map(git.files.map((file) => [file.path, file.status])),
    [git.files],
  )

  const isSearching = Boolean(query.trim())
  const filteredTree = useMemo(() => {
    if (!isSearching) return treeRoots
    return searchTree ? filterFileTree(searchTree, query) : []
  }, [isSearching, treeRoots, searchTree, query])
  const visibleNodes = useMemo(
    () => flattenVisibleTree(filteredTree, expandedIds, isSearching),
    [filteredTree, expandedIds, isSearching],
  )
  const displayedNodes = visibleNodes.slice(0, visibleLimit)

  const allDirIds = useMemo(() => collectDirectoryIds(treeRoots), [treeRoots])

  const handleQueryChange = (value: string) => {
    setQuery(value)
    if (value.trim() && searchTree === null && !searchLoading) void loadSearchTree()
  }

  const toggleExpand = (node: FileTreeNode) => {
    if (expandedIds.has(node.id)) {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.delete(node.id)
        return next
      })
      return
    }
    setExpandedIds((prev) => new Set(prev).add(node.id))
    if (node.childrenLoaded || loadingIds.has(node.id)) return
    void loadChildren(node)
  }

  const collapseAll = () => {
    setExpandedIds(new Set())
  }

  const expandAll = () => {
    const directories: FileTreeNode[] = []
    const collect = (nodes: FileTreeNode[]) => {
      for (const node of nodes) {
        if (node.type !== 'directory') continue
        directories.push(node)
        collect(node.children)
      }
    }
    collect(treeRoots)
    setExpandedIds(new Set(directories.map((node) => node.id)))
    for (const node of directories) {
      if (!node.childrenLoaded && !loadingIds.has(node.id)) void loadChildren(node)
    }
  }

  if (!project) {
    return (
      <EmptyState icon={<Folder size={24} />} title={t('inspector.files.emptyTitle')}>
        {t('inspector.files.emptyBody')}
      </EmptyState>
    )
  }

  const contentLoading = isSearching ? searchLoading : loading
  const contentError = isSearching ? searchError : error

  return (
    <div className="files-panel">
      <div className="files-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder={t('inspector.files.filterPlaceholder')}
        />
        {!isSearching && allDirIds.size > 0 ? (
          expandedIds.size > 0 ? (
            <IconButton size="small" label={t('inspector.files.collapseAll')} onClick={collapseAll}>
              <Folder size={13} />
            </IconButton>
          ) : (
            <IconButton size="small" label={t('inspector.files.expandAll')} onClick={expandAll}>
              <FolderOpen size={13} />
            </IconButton>
          )
        ) : null}
        <IconButton size="small" label={t('inspector.files.refresh')} onClick={() => void load()}>
          <RefreshCw className={loading ? 'spin' : ''} size={13} />
        </IconButton>
      </div>

      <div className="file-tree scroll-area">
        <button
          type="button"
          className="tree-root"
          onClick={() => onReveal(project.primaryFolder)}
          title={project.primaryFolder}
        >
          <Folder size={14} />
          <strong>
            {project.folders.length > 1
              ? t('inspector.files.projectFoldersCount', { count: project.folders.length })
              : basename(project.primaryFolder)}
          </strong>
        </button>

        {contentLoading ? <p>{t('inspector.files.loading')}</p> : null}
        {contentError ? <p>{t('inspector.files.listError', { error: contentError })}</p> : null}
        {!contentLoading && !contentError && !isSearching && skipped > 0 ? (
          <p className="file-tree__skipped">
            {t('inspector.files.skippedFolders', { count: skipped })}
          </p>
        ) : null}
        {!contentLoading && !contentError && isSearching && searchTruncated ? (
          <p className="file-tree__skipped">{t('inspector.files.searchTruncated')}</p>
        ) : null}

        {!contentLoading && !contentError
          ? displayedNodes.map((node) => {
              const isDirectory = node.type === 'directory'
              const isExpanded = isSearching || expandedIds.has(node.id)
              const isLoadingNode = loadingIds.has(node.id)
              const nodeError = expandErrors.get(node.id)
              const canExpand = isDirectory && (!node.childrenLoaded || node.children.length > 0)
              const status =
                node.root === project.primaryFolder ? changed.get(node.path) : undefined

              if (isDirectory) {
                return (
                  <button
                    type="button"
                    key={node.id}
                    className="file-tree__item is-directory"
                    style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                    title={nodeError ? `${node.path || node.name}\n${nodeError}` : node.path || node.name}
                    aria-expanded={isExpanded}
                    onClick={isSearching ? undefined : () => toggleExpand(node)}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      onReveal(node.fullPath)
                    }}
                  >
                    <span className="file-tree__chevron">
                      {isLoadingNode ? (
                        <RefreshCw className="spin" size={13} />
                      ) : canExpand ? (
                        isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />
                      ) : (
                        <span className="file-tree__expander-placeholder" />
                      )}
                    </span>
                    <span className="file-tree__icon">
                      {isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
                    </span>
                    <span className="file-tree__name">{node.name}</span>
                    {nodeError ? <small className="file-tree__status file-tree__status--deleted">!</small> : null}
                    {status ? (
                      <small
                        className={`file-tree__status ${
                          status === 'M'
                            ? 'file-tree__status--modified'
                            : status === 'A'
                              ? 'file-tree__status--added'
                              : status === 'D'
                                ? 'file-tree__status--deleted'
                                : ''
                        }`}
                      >
                        {status}
                      </small>
                    ) : null}
                  </button>
                )
              }

              return (
                <button
                  type="button"
                  key={node.id}
                  className="file-tree__item is-file"
                  style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                  title={node.path}
                  onClick={() => onReveal(node.fullPath)}
                >
                  <span className="file-tree__expander-placeholder" />
                  <span className="file-tree__icon">{getFileIcon(node.name)}</span>
                  <span className="file-tree__name">{node.name}</span>
                  {status ? (
                    <small
                      className={`file-tree__status ${
                        status === 'M'
                          ? 'file-tree__status--modified'
                          : status === 'A'
                            ? 'file-tree__status--added'
                            : status === 'D'
                              ? 'file-tree__status--deleted'
                              : ''
                      }`}
                    >
                      {status}
                    </small>
                  ) : null}
                </button>
              )
            })
          : null}

        {!contentLoading && !contentError && visibleNodes.length > displayedNodes.length ? (
          <button
            type="button"
            className="file-tree__show-more"
            onClick={() =>
              setVisibleLimit((limit) => Math.min(visibleNodes.length, limit + 1_000))
            }
          >
            {t('inspector.files.showMore', { count: Math.min(1_000, visibleNodes.length - displayedNodes.length) })}
          </button>
        ) : null}

        {!contentLoading && !contentError && treeRoots.length > 0 && visibleNodes.length === 0 ? (
          <p>{query.trim() ? t('inspector.files.noMatch', { query }) : t('inspector.files.noProjectFiles')}</p>
        ) : null}

        {!contentLoading && !contentError && treeRoots.length === 0 ? <p>{t('inspector.files.noProjectFiles')}</p> : null}
      </div>
    </div>
  )
}
