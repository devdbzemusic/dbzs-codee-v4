import React, { useEffect, useRef, useState } from "react";

interface LazyCardProps {
  children: React.ReactNode;
  minHeight?: number;
}

/**
 * A lightweight IntersectionObserver wrapper that unmounts its children
 * when they scroll far outside of the viewport (600px margin).
 * This keeps the DOM small and automatically frees memory from Monaco/Diff instances
 * inside historical message cards without requiring fixed height parameters.
 */
export function LazyCard({ children, minHeight = 60 }: LazyCardProps) {
  const [isVisible, setIsVisible] = useState(true); // Start visible to avoid initial flicker
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const elementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
        if (entry.isIntersecting && entry.target.clientHeight > 0) {
          setMeasuredHeight(entry.target.clientHeight);
        }
      },
      {
        root: null, // viewport
        rootMargin: "800px 0px 800px 0px" // Load/retain cards within 800px margin
      }
    );

    observer.observe(el);
    return () => {
      observer.unobserve(el);
    };
  }, []);

  const currentHeight = measuredHeight !== null ? `${measuredHeight}px` : `${minHeight}px`;

  return (
    <div
      ref={elementRef}
      style={{
        minHeight: isVisible ? undefined : currentHeight,
        height: isVisible ? undefined : currentHeight
      }}
    >
      {isVisible ? children : <div className="border border-dbzs-border/20 bg-dbzs-panelSoft/30 rounded opacity-20" style={{ height: "100%" }} />}
    </div>
  );
}
