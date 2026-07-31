import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import {
  workspaceFixtures,
} from './fixtures/workspace-sidebar'
import { WorkspaceGroupDisclosureView } from './workspace-group-disclosure-view'
import { WorkspaceProjectsSectionView } from './workspace-projects-section-view'
import type {
  WorkspaceSidebarListFilters,
  WorkspaceSidebarProjectSortDirection,
  WorkspaceSidebarProjectSortKey,
  WorkspaceSidebarSourceFilter,
  WorkspaceSidebarStatusFilter,
  WorkspaceSidebarWorkPrFilter,
} from './workspace-sidebar-ui-store'
import {
  DEFAULT_SESSION_PREVIEW_LIMIT,
  DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
} from './workspace-sidebar-ui-store'

function toggleInList<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter(entry => entry !== value)
    : [...list, value]
}

function WorkspaceProjectsSectionCatalog() {
  const [listFilters, setListFilters]
    = useState<WorkspaceSidebarListFilters>(DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS)
  const [projectSortKey, setProjectSortKey]
    = useState<WorkspaceSidebarProjectSortKey>('name')
  const [projectSortDirection, setProjectSortDirection]
    = useState<WorkspaceSidebarProjectSortDirection>('asc')
  const [projectPinnedFirst, setProjectPinnedFirst] = useState(true)
  const [sessionPreviewLimit, setSessionPreviewLimit]
    = useState(DEFAULT_SESSION_PREVIEW_LIMIT)
  const [localExpanded, setLocalExpanded] = useState(true)
  const filteredEmpty = listFilters.statusFilters.includes('streaming')
    && listFilters.projectScope === 'pinned'

  return (
    <WorkspaceProjectsSectionView
      hasWorkspaces
      filteredEmpty={filteredEmpty}
      listFilters={listFilters}
      projectSortKey={projectSortKey}
      projectSortDirection={projectSortDirection}
      projectPinnedFirst={projectPinnedFirst}
      sessionPreviewLimit={sessionPreviewLimit}
      adding={false}
      multiWorkspaceEnabled
      hasUnreadWorkspaceSessions
      markingAllSessionsRead={false}
      onProjectScopeChange={projectScope =>
        setListFilters(current => ({ ...current, projectScope }))}
      onToggleStatusFilter={(filter: WorkspaceSidebarStatusFilter) =>
        setListFilters(current => ({
          ...current,
          statusFilters: toggleInList(current.statusFilters, filter),
        }))}
      onToggleWorkPrFilter={(filter: WorkspaceSidebarWorkPrFilter) =>
        setListFilters(current => ({
          ...current,
          workPrFilters: toggleInList(current.workPrFilters, filter),
        }))}
      onToggleSourceFilter={(filter: WorkspaceSidebarSourceFilter) =>
        setListFilters(current => ({
          ...current,
          sourceFilters: toggleInList(current.sourceFilters, filter),
        }))}
      onShowArchivedChange={showArchived =>
        setListFilters(current => ({ ...current, showArchived }))}
      onClearListFilters={() => setListFilters(DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS)}
      onProjectSortKeyChange={setProjectSortKey}
      onProjectSortDirectionChange={setProjectSortDirection}
      onProjectPinnedFirstChange={setProjectPinnedFirst}
      onSessionPreviewLimitChange={setSessionPreviewLimit}
      onCollapseAll={() => {}}
      onAddFromPicker={() => {}}
      onOpenMultiWorkspaceDialog={() => {}}
      onMarkAllAsRead={() => {}}
    >
      <WorkspaceGroupDisclosureView
        workspace={workspaceFixtures.local}
        workspacePinned
        workspaceActions={[]}
        runningSessionCount={0}
        expanded={localExpanded}
        overlays={null}
        onToggleExpanded={() => setLocalExpanded(current => !current)}
        onOpenWorkspace={() => {}}
      >
        <div className="ml-4.25 border-l border-sidebar-border/50 px-4 py-2 text-[11px] text-muted-foreground">
          Refactor workspace sidebar
        </div>
      </WorkspaceGroupDisclosureView>
      <WorkspaceGroupDisclosureView
        workspace={workspaceFixtures.remote}
        workspacePinned={false}
        workspaceActions={[]}
        runningSessionCount={2}
        expanded={false}
        overlays={null}
        onToggleExpanded={() => {}}
        onOpenWorkspace={() => {}}
      >
        {null}
      </WorkspaceGroupDisclosureView>
      <WorkspaceGroupDisclosureView
        workspace={workspaceFixtures.missing}
        workspacePinned={false}
        workspaceActions={[]}
        runningSessionCount={0}
        expanded={false}
        overlays={null}
        onToggleExpanded={() => {}}
        onOpenWorkspace={() => {}}
      >
        {null}
      </WorkspaceGroupDisclosureView>
    </WorkspaceProjectsSectionView>
  )
}

const meta = {
  title: 'App/Workspace/Projects Section',
  component: WorkspaceProjectsSectionView,
  decorators: [
    Story => (
      <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
        <section className="w-full max-w-80 border border-sidebar-border bg-sidebar py-2 shadow-sm">
          <Story />
        </section>
      </main>
    ),
  ],
  args: {
    hasWorkspaces: true,
    filteredEmpty: false,
    listFilters: DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
    projectSortKey: 'name',
    projectSortDirection: 'asc',
    projectPinnedFirst: true,
    sessionPreviewLimit: DEFAULT_SESSION_PREVIEW_LIMIT,
    adding: false,
    multiWorkspaceEnabled: true,
    hasUnreadWorkspaceSessions: true,
    markingAllSessionsRead: false,
    children: null,
    onProjectScopeChange: fn(),
    onToggleStatusFilter: fn(),
    onToggleWorkPrFilter: fn(),
    onToggleSourceFilter: fn(),
    onShowArchivedChange: fn(),
    onClearListFilters: fn(),
    onProjectSortKeyChange: fn(),
    onProjectSortDirectionChange: fn(),
    onProjectPinnedFirstChange: fn(),
    onSessionPreviewLimitChange: fn(),
    onCollapseAll: fn(),
    onAddFromPicker: fn(),
    onOpenMultiWorkspaceDialog: fn(),
    onMarkAllAsRead: fn(),
  },
} satisfies Meta<typeof WorkspaceProjectsSectionView>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {
  render: () => <WorkspaceProjectsSectionCatalog />,
  parameters: {
    controls: { disable: true },
  },
}

export const Empty: Story = {
  args: {
    hasWorkspaces: false,
    hasUnreadWorkspaceSessions: false,
  },
}

export const FilteredEmpty: Story = {
  args: {
    filteredEmpty: true,
    listFilters: {
      ...DEFAULT_WORKSPACE_SIDEBAR_LIST_FILTERS,
      statusFilters: ['streaming'],
    },
    hasUnreadWorkspaceSessions: false,
  },
}

export const MarkingAllRead: Story = {
  args: {
    markingAllSessionsRead: true,
  },
}
