import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KanbanIssue, KanbanIssueRelation } from '~/features/kanban/types'
import kanbanLocale from '~/locales/default/kanban'

import { RelationManager } from './relation-manager'

const mocks = vi.hoisted(() => ({
  addRelationMutate: vi.fn(),
  deleteRelationMutate: vi.fn(),
  issues: [] as KanbanIssue[],
  relations: [] as KanbanIssueRelation[],
  searchIssues: [] as KanbanIssue[],
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const template = (kanbanLocale as Record<string, string>)[key] ?? key
      return template.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => params?.[name] ?? '')
    },
  }),
}))

vi.mock('~/features/workspace/use-workspace', () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: 'workspace-1', identifier: 'CRA' }],
  }),
}))

vi.mock('../use-kanban', () => ({
  useAddRelation: () => ({
    isPending: false,
    mutate: mocks.addRelationMutate,
  }),
  useDeleteRelation: () => ({
    mutate: mocks.deleteRelationMutate,
  }),
  useIssues: () => ({
    data: mocks.issues,
    isLoading: false,
  }),
  useRelations: () => ({
    data: mocks.relations,
  }),
  useSearchIssues: () => ({
    data: mocks.searchIssues,
    isFetching: false,
  }),
}))

const PopoverContext = createContext<{
  open: boolean
  onOpenChange?: (open: boolean) => void
}>({ open: false })

vi.mock('~/components/ui/popover', () => ({
  Popover: ({ children, open, onOpenChange }: { children: ReactNode, open?: boolean, onOpenChange?: (open: boolean) => void }) => (
    <PopoverContext.Provider value={{ open: !!open, onOpenChange }}>
      <div>{children}</div>
    </PopoverContext.Provider>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => {
    const context = useContext(PopoverContext)
    return context.open ? <div>{children}</div> : null
  },
  PopoverTrigger: ({ children, ...props }: ComponentProps<'button'>) => (
    <PopoverContext.Consumer>
      {context => (
        <button type="button" {...props} onClick={() => context.onOpenChange?.(true)}>
          {children}
        </button>
      )}
    </PopoverContext.Consumer>
  ),
}))

vi.mock('~/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="relation-skeleton" />,
}))

afterEach(() => {
  cleanup()
})

const now = 1_700_000_000

function issue(id: string, number: number, title: string): KanbanIssue {
  return {
    id,
    workspaceId: 'workspace-1',
    number,
    statusId: null,
    milestoneId: null,
    parentIssueId: null,
    title,
    description: null,
    priority: 'none',
    labels: [],
    assigneeKind: null,
    assigneeId: null,
    dueDate: null,
    createdByKind: 'user',
    createdById: '__self__',
    sourceChatSessionId: null,
    delegateAgentId: null,
    delegateProviderTargetId: null,
    contextRefs: '[]',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }
}

function relation(
  id: string,
  counterpartIssue: KanbanIssue,
  type: KanbanIssueRelation['type'],
  direction: KanbanIssueRelation['direction'],
): KanbanIssueRelation {
  return {
    id,
    sourceIssueId: direction === 'outgoing' ? 'issue-current' : counterpartIssue.id,
    targetIssueId: direction === 'outgoing' ? counterpartIssue.id : 'issue-current',
    type,
    createdAt: now,
    direction,
    counterpart: {
      id: counterpartIssue.id,
      workspaceId: counterpartIssue.workspaceId,
      number: counterpartIssue.number,
      title: counterpartIssue.title,
      statusId: counterpartIssue.statusId,
      priority: counterpartIssue.priority,
    },
  }
}

function openComposer() {
  fireEvent.click(screen.getByRole('button', { name: 'Add a relation' }))
}

function pickKind(kind: string) {
  fireEvent.click(screen.getByTestId(`issue-relation-kind-${kind}`))
}

function renderManager(readOnly = false) {
  return render(
    <RelationManager issueId="issue-current" workspaceId="workspace-1" readOnly={readOnly} />,
  )
}

describe('relation manager', () => {
  beforeEach(() => {
    mocks.addRelationMutate.mockReset()
    mocks.addRelationMutate.mockImplementation((_input, options) => options?.onSuccess?.())
    mocks.deleteRelationMutate.mockReset()
    mocks.issues = [
      issue('issue-current', 1, 'Current issue'),
      issue('issue-a', 2, 'Alpha target'),
      issue('issue-b', 3, 'Beta target'),
      issue('issue-c', 4, 'Gamma target'),
    ]
    mocks.searchIssues = []
    mocks.relations = []
  })

  it('renders one chip per relation with kind label and issue key', () => {
    mocks.relations = [
      relation('rel-1', issue('issue-a', 2, 'Alpha target'), 'blocks', 'outgoing'),
      relation('rel-2', issue('issue-b', 3, 'Beta target'), 'blocks', 'incoming'),
      relation('rel-3', issue('issue-c', 4, 'Gamma target'), 'relates_to', 'outgoing'),
    ]

    renderManager()

    expect(screen.getByRole('button', { name: 'Blocks CRA-2: Alpha target' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Blocked by CRA-3: Beta target' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Related to CRA-4: Gamma target' })).toBeTruthy()
  })

  it('creates an outgoing blocks relation from the composer', () => {
    renderManager()

    openComposer()
    pickKind('blocks')
    fireEvent.click(screen.getByRole('option', { name: /CRA-2.*Alpha target/ }))

    expect(mocks.addRelationMutate).toHaveBeenCalledWith({
      sourceIssueId: 'issue-current',
      targetIssueId: 'issue-a',
      type: 'blocks',
    }, expect.any(Object))
  })

  it('creates an inverse edge when blocked by is selected', () => {
    renderManager()

    openComposer()
    pickKind('blocked-by')
    fireEvent.click(screen.getByRole('option', { name: /CRA-2.*Alpha target/ }))

    expect(mocks.addRelationMutate).toHaveBeenCalledWith({
      sourceIssueId: 'issue-a',
      targetIssueId: 'issue-current',
      type: 'blocks',
    }, expect.any(Object))
  })

  it('creates the highlighted candidate on enter after filtering', () => {
    renderManager()

    openComposer()
    pickKind('relates-to')
    const input = screen.getByTestId('issue-relation-search')
    fireEvent.change(input, { target: { value: 'Beta' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(mocks.addRelationMutate).toHaveBeenCalledWith({
      sourceIssueId: 'issue-current',
      targetIssueId: 'issue-b',
      type: 'relates_to',
    }, expect.any(Object))
  })

  it('excludes already-related issues from the composer suggestions', () => {
    mocks.relations = [
      relation('rel-1', issue('issue-a', 2, 'Alpha target'), 'blocks', 'outgoing'),
    ]

    renderManager()

    openComposer()
    expect(screen.queryByRole('option', { name: /CRA-2.*Alpha target/ })).toBeNull()
    expect(screen.getByRole('option', { name: /CRA-3.*Beta target/ })).toBeTruthy()
  })

  it('deletes a relation from its chip', () => {
    mocks.relations = [
      relation('rel-1', issue('issue-a', 2, 'Alpha target'), 'blocks', 'outgoing'),
    ]

    renderManager()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Blocks relation to CRA-2' }))

    expect(mocks.deleteRelationMutate).toHaveBeenCalledWith({
      id: 'rel-1',
      issueId: 'issue-current',
    })
  })

  it('hides the add entry and delete affordances in read-only mode', () => {
    mocks.relations = [
      relation('rel-1', issue('issue-a', 2, 'Alpha target'), 'blocks', 'outgoing'),
    ]

    renderManager(true)

    expect(screen.queryByRole('button', { name: 'Add a relation' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove Blocks relation/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Blocks CRA-2: Alpha target' })).toBeTruthy()
  })
})
