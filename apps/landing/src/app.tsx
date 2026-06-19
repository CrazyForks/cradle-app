import { useEffect, useState } from 'react'
import { ChangelogPage } from './components/changelog'
import { CTASection } from './components/cta-section'
import { Footer } from './components/footer'
import { Hero } from './components/hero'
import { Nav } from './components/nav'
import { ProblemSection } from './components/problem'
import { IntersectionLayout } from './components/blueprint-annotations'

type Route = 'home' | 'changelog'

function useHashRoute(): [Route, () => void] {
  const read = (): Route =>
    window.location.hash.replace(/^#\/?/, '') === 'changelog' ? 'changelog' : 'home'
  const [route, setRoute] = useState<Route>(read)

  useEffect(() => {
    const onHash = () => {
      setRoute(read())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const goHome = () => {
    if (window.location.hash) {
      window.location.hash = ''
    } else {
      setRoute('home')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return [route, goHome]
}

export function App() {
  const [route, goHome] = useHashRoute()

  if (route === 'changelog') {
    return (
      <IntersectionLayout>
        <Nav />
        <ChangelogPage onBack={goHome} />
        <Footer />
      </IntersectionLayout>
    )
  }

  return (
    <IntersectionLayout>
      <Nav />
      <main>
        <Hero />
        <ProblemSection />
        {/* <StatsSection /> */}
        {/* <Features /> */}
        {/* <HowItWorksSection /> */}
        {/* <ComparisonSection /> */}
        <CTASection />
      </main>
      <Footer />
    </IntersectionLayout>
  )
}
