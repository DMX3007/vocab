export type SurfaceTypes = | 'idle' | 'icon' | 'tooltip' | 'overlay'

export enum SURFACE_TYPES {
    IDLE = 'idle',
    ICON = 'icon',
    TOOLTIP = 'tooltip',
    OVERLAY = 'overlay'
}

export interface SurfaceState {
    status: SurfaceTypes
}

export type SurfaceEvents = | { name: 'WORD_SELECTED' } | { name: 'REPEAT_DUE' } | { name: 'ICON_CLICKED' } | { name: 'CLICK_OUTSIDE' }

export function initialSurfaceState() {
    return {
        status: SURFACE_TYPES.IDLE
    }
}

export function surfaceReducer(event: SurfaceEvents, state: SurfaceState): SurfaceState {
    switch (event.name) {
        case "WORD_SELECTED": {
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
                ...state,
                status: 'idle'
            }
        }
    }
}