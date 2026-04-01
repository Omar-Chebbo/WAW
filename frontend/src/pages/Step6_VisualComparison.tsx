import React from 'react'
import { StepCard } from '../components/ui'
import VisualizationWorkspace from '../components/lab/VisualizationWorkspace'

export default function Step6() {
  return (
    <StepCard
      stepNumber={6}
      title="Visual Comparison"
      subtitle="Explore the original graph alongside the extracted backbone. Use scroll to zoom and drag to pan."
    >
      <VisualizationWorkspace mode="wizard" />
    </StepCard>
  )
}