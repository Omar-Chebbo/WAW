import React from 'react'
import { StepCard } from '../components/ui'
import BackboneExtractionWorkspace from '../components/lab/BackboneExtractionWorkspace'

export default function Step5() {
  return (
    <StepCard
      stepNumber={5}
      title="Backbone Extraction"
      subtitle="Extract the backbone graph for each ready method and review the structural summary."
    >
      <BackboneExtractionWorkspace mode="wizard" />
    </StepCard>
  )
}