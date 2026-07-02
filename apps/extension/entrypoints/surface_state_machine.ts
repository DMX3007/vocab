export type SurfaceTypes = | 'idle' | 'icon' | 'tooltip' | 'overlay'

export interface SurfaceState {
    status: SurfaceTypes
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
                ...state,
                status: 'icon'
            }
        }
        case "ICON_CLICKED": {
            return {
                ...state,
                status: 'tooltip'
            }
        }
        case "WORD_SAVED": {
            return {
                ...state,
                status: 'idle'
            }
        }
        case "SELECTION_COLLAPSED": {
            return {
                ...state,
                status: 'idle'
            }
        }
        case "CLICK_OUTSIDE": {
            return {
                ...state,
                status: 'idle'
            }
        }
        case "REPEAT_DUE": {
            return {
                ...state,
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