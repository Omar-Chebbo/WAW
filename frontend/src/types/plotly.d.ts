declare module 'plotly.js-dist-min' {
  import Plotly from 'plotly.js-dist'
  export default Plotly
}

declare module 'plotly.js-dist' {
  namespace Plotly {
    interface Data {
      x?: (number | string)[]
      y?: (number | string)[]
      z?: (number | string)[]
      mode?: string
      type?: string
      name?: string
      marker?: {
        size?: number
        color?: string | number[]
        opacity?: number
        line?: { width: number }
        colorscale?: string | (string | number)[]
        showscale?: boolean
        colorbar?: Record<string, unknown>
        [key: string]: unknown
      }
      hovertemplate?: string
      customdata?: unknown[]
      line?: { width: number; color?: string; dash?: string }
      text?: string[]
      opacity?: number
      [key: string]: unknown
    }

    interface Layout {
      scene?: {
        xaxis?: {
          title?: { text?: string; font?: { size?: number } }
          gridcolor?: string
          zerolinecolor?: string
          showbackground?: boolean
          backgroundcolor?: string
          range?: number[]
          [key: string]: unknown
        }
        yaxis?: {
          title?: { text?: string; font?: { size?: number } }
          gridcolor?: string
          zerolinecolor?: string
          showbackground?: boolean
          backgroundcolor?: string
          range?: number[]
          [key: string]: unknown
        }
        zaxis?: {
          title?: { text?: string; font?: { size?: number } }
          gridcolor?: string
          zerolinecolor?: string
          showbackground?: boolean
          backgroundcolor?: string
          range?: number[]
          [key: string]: unknown
        }
        bgcolor?: string
        camera?: {
          eye?: { x: number; y: number; z: number }
          center?: { x: number; y: number; z: number }
          up?: { x: number; y: number; z: number }
        }
        [key: string]: unknown
      }
      paper_bgcolor?: string
      plot_bgcolor?: string
      font?: { family?: string; size?: number; color?: string }
      margin?: { l: number; r: number; t: number; b: number }
      legend?: {
        x?: number
        y?: number
        bgcolor?: string
        bordercolor?: string
        borderwidth?: number
        font?: { size?: number }
        [key: string]: unknown
      }
      hoverlabel?: {
        bgcolor?: string
        bordercolor?: string
        font?: { size?: number; color?: string }
      }
      [key: string]: unknown
    }

    interface Config {
      responsive?: boolean
      displayModeBar?: boolean
      modeBarButtonsToRemove?: string[]
      displaylogo?: boolean
      scrollZoom?: boolean
      [key: string]: unknown
    }

    interface DownloadImageOptions {
      format?: string
      width?: number
      height?: number
      scale?: number
      filename?: string
    }

    function newPlot(
      root: HTMLElement,
      data: Data[],
      layout?: Partial<Layout>,
      config?: Partial<Config>
    ): Promise<void>

    function purge(root: HTMLElement): void

    function downloadImage(
      root: HTMLElement,
      opts: DownloadImageOptions
    ): void
  }

  const Plotly: typeof Plotly.Plotly
  export default Plotly
}
