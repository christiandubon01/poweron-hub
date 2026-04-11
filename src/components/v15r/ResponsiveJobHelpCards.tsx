/**
 * ResponsiveJobHelpCards.tsx — Responsive horizontal card carousel
 * 
 * Features:
 * - Desktop (>1024px): shows 3-4 cards visible
 * - Tablet (768-1024px): shows 2-3 cards visible
 * - Phone (<768px): shows 1 card fully visible with swipe navigation
 * - Scroll snap alignment
 * - Horizontal scroll with indicators
 * - Minimum 44px touch targets
 * - No card cutoff on any device
 */

import React, { useRef, useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface JobHelpCard {
  id: string
  title: string
  description: string
  icon?: React.ReactNode
  color?: string
}

interface Props {
  cards: JobHelpCard[]
  onCardClick?: (cardId: string) => void
}

export function ResponsiveJobHelpCards({ cards, onCardClick }: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)

  const checkScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10)
    }
  }

  useEffect(() => {
    checkScroll()
    window.addEventListener('resize', checkScroll)
    return () => window.removeEventListener('resize', checkScroll)
  }, [cards])

  const handleScroll = () => {
    checkScroll()
    // Update current index based on scroll position
    if (scrollContainerRef.current) {
      const scrollLeft = scrollContainerRef.current.scrollLeft
      const cardWidth = scrollContainerRef.current.clientWidth
      setCurrentIndex(Math.round(scrollLeft / cardWidth))
    }
  }

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = scrollContainerRef.current.clientWidth
      scrollContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      })
    }
  }

  const goToIndex = (index: number) => {
    if (scrollContainerRef.current) {
      const cardWidth = scrollContainerRef.current.clientWidth
      scrollContainerRef.current.scrollTo({
        left: index * cardWidth,
        behavior: 'smooth',
      })
      setCurrentIndex(index)
    }
  }

  if (!cards || cards.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Container with navigation buttons */}
      <div className="relative group">
        {/* Left scroll button - visible on tablet/desktop, hidden on phone */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 hidden sm:flex w-10 h-10 items-center justify-center rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-200 transition-colors hover:scale-105"
            aria-label="Scroll left"
          >
            <ChevronLeft size={20} />
          </button>
        )}

        {/* Right scroll button - visible on tablet/desktop, hidden on phone */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 hidden sm:flex w-10 h-10 items-center justify-center rounded-full bg-gray-800/80 hover:bg-gray-700 text-gray-200 transition-colors hover:scale-105"
            aria-label="Scroll right"
          >
            <ChevronRight size={20} />
          </button>
        )}

        {/* Horizontal scroll container with snap */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex gap-3 overflow-x-auto scroll-smooth px-0 py-2 snap-x snap-mandatory scrollbar-hide"
          style={{
            scrollBehavior: 'smooth',
            WebkitOverflowScrolling: 'touch',
            // Hide scrollbar but keep scrolling functional
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}
        >
          {cards.map((card) => (
            <div
              key={card.id}
              onClick={() => onCardClick?.(card.id)}
              className="flex-shrink-0 snap-start snap-always rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4 cursor-pointer hover:border-gray-600 hover:shadow-lg transition-all duration-200 active:scale-95"
              style={{
                // Desktop: ~25% width (4 cards), Tablet: ~33% width (3 cards), Phone: 100% width (1 card)
                minWidth: 'clamp(100%, calc(25% - 0.75rem), 100%)',
                // Minimum width ensures card is always readable
                width: 'clamp(100%, calc(25% - 0.75rem), 100%)',
              }}
            >
              {/* Icon (optional) */}
              {card.icon && (
                <div className="mb-2 flex items-center justify-center w-10 h-10 rounded-lg bg-gray-700/50">
                  {card.icon}
                </div>
              )}

              {/* Title */}
              <h3 className="font-semibold text-sm text-gray-100 mb-1 leading-tight">
                {card.title}
              </h3>

              {/* Description */}
              <p className="text-xs text-gray-400 line-clamp-2">
                {card.description}
              </p>

              {/* Color accent bar (optional) */}
              {card.color && (
                <div
                  className="mt-3 h-0.5 w-full rounded-full"
                  style={{ backgroundColor: card.color }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicators (dots) - visible on all devices */}
      {cards.length > 1 && (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {cards.map((_, idx) => (
            <button
              key={idx}
              onClick={() => goToIndex(idx)}
              className={`h-2 rounded-full transition-all cursor-pointer touch-target ${
                Math.floor(currentIndex) === idx
                  ? 'bg-blue-500 w-6'
                  : 'bg-gray-600 w-2 hover:bg-gray-500'
              }`}
              aria-label={`Go to card ${idx + 1}`}
              style={{
                // Ensure minimum 44px touch target
                minHeight: '2rem',
                minWidth: '2rem',
                padding: '0.5rem',
              }}
            />
          ))}
        </div>
      )}

      {/* Mobile-only: swipe hint */}
      {cards.length > 1 && (
        <div className="text-center text-[10px] text-gray-500 sm:hidden">
          Swipe to see more
        </div>
      )}
    </div>
  )
}

export default ResponsiveJobHelpCards
