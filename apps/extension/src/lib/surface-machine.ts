export type SurfaceTypes = | 'idle' | 'icon' | 'tooltip' | 'overlay'

export interface SurfaceState {
    status: SurfaceTypes
    term?: string
    contextSentence?: string
    x?: number
    y?: number
}

export type SurfaceEvents = |
{ name: 'WORD_SELECTED', term: string, contextSentence: string, x: number, y: number } |
{ name: 'ICON_CLICKED' } |
{ name: 'CLICK_OUTSIDE' } |
{ name: 'SELECTION_COLLAPSED' } |
{ name: "WORD_SAVED" } |
{ name: 'REPEAT_DUE' }

export function initialSurfaceState(): SurfaceState {
    return { status: "idle" }
}

export function surfaceReducer(state: SurfaceState, action: SurfaceEvents): SurfaceState {
    switch (action.name) {
        case "WORD_SELECTED": {
            // overlay priority
            if (state.status === 'overlay') {
                return {
                    ...state
                }
            }
            return {
                status: 'icon',
                term: action.term,
                contextSentence: action.contextSentence,
                x: action.x,
                y: action.y,
            }
        }
        case "ICON_CLICKED": {
            return {
                ...state,
                status: 'tooltip'
            }
        }
        case "WORD_SAVED": {
            return initialSurfaceState()
        }
        case "SELECTION_COLLAPSED": {
            return initialSurfaceState()
        }
        case "CLICK_OUTSIDE": {
            return initialSurfaceState()
        }
        case "REPEAT_DUE": {
            return {
                status: 'overlay'
            }
        }
        default: {
            return {
                ...state
            }
        }
    }
}
