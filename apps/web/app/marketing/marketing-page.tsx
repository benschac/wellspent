"use client";

import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  Cross1Icon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
} from "@radix-ui/react-icons";
import { useEffect, useRef, useState } from "react";
import { GlassFocus } from "./glass-focus";

const sessions = [
  {
    title: "Redesign the editor",
    time: "9:12 AM",
    duration: "32m 18s",
    summary: "Simplified navigation and resolved the empty states.",
    detail:
      "Made the editing flow easier to follow. Tomorrow: put the new empty states in front of someone seeing the editor for the first time.",
  },
  {
    title: "Build the prototype",
    time: "11:05 AM",
    duration: "1h 32m",
    summary: "Navigation working. Ready to test.",
    detail:
      "Connected the key screens and worked through the empty states. The next session has a clear starting point: test the transitions on mobile.",
  },
] as const;
type JournalTab = "Session" | "Notes" | "Recap";

export function MarketingPage({
  className,
  waitlistUrl,
}: {
  className: string;
  waitlistUrl: string | undefined;
}) {
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(1938);
  const elapsed = useRef(1938);
  const [tab, setTab] = useState<JournalTab>("Recap");
  const [note, setNote] = useState(
    "A clearer first experience. Fewer steps between an idea and a working prototype.",
  );
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const railPosition = useRef({ x: 0, y: 0 });
  const returnFrame = useRef(0);
  function positionRail(x: number, y: number) {
    const host = artRef.current;
    if (!host) return;
    if (x || y) host.dataset.railDragged = "true";
    railPosition.current = { x, y };
    host.style.setProperty("--rail-x", `${x}px`);
    host.style.setProperty("--rail-y", `${y}px`);
    host.dispatchEvent(
      new CustomEvent("focus-rail-drag", { detail: { x, y } }),
    );
  }
  function settleRail() {
    dragOrigin.current = null;
    cancelAnimationFrame(returnFrame.current);
    let previous = performance.now();
    const settle = (now: number) => {
      const remaining = Math.exp(-14 * Math.min((now - previous) / 1000, 0.05));
      previous = now;
      const { x, y } = railPosition.current;
      if (document.hidden || Math.abs(x) + Math.abs(y) < 0.15) {
        positionRail(0, 0);
        returnFrame.current = 0;
        return;
      }
      positionRail(x * remaining, y * remaining);
      returnFrame.current = requestAnimationFrame(settle);
    };
    returnFrame.current = requestAnimationFrame(settle);
  }

  useEffect(() => () => cancelAnimationFrame(returnFrame.current), []);

  useEffect(() => {
    if (!running) return;
    const started = performance.now();
    const initial = elapsed.current;
    const tick = () => {
      elapsed.current =
        initial + Math.floor((performance.now() - started) / 1000);
      setSeconds(elapsed.current);
    };
    const interval = window.setInterval(tick, 250);
    return () => {
      clearInterval(interval);
    };
  }, [running]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("gh-revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    page.querySelectorAll("[data-reveal]").forEach((element) => {
      element.classList.add("gh-will-reveal");
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  function joinWaitlist() {
    if (waitlistUrl) window.location.assign(waitlistUrl);
    else dialogRef.current?.showModal();
  }
  function resetDemo() {
    setRunning(false);
    elapsed.current = 0;
    setSeconds(0);
  }
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");

  return (
    <div ref={pageRef} className={`gh-page ${className}`}>
      <a className="gh-skip" href="#main-content">
        Skip to content
      </a>
      <div className="gh-opening">
        <header className="gh-header">
          <a className="gh-wordmark" href="/" aria-label="Good Hours home">
            Good Hours
          </a>
          <nav aria-label="Main navigation">
            <a className="gh-nav-link" href="#our-approach">
              The idea
            </a>
            <button
              className="gh-button gh-button-small"
              onClick={joinWaitlist}
              type="button"
            >
              Join the waitlist
            </button>
          </nav>
        </header>
        <main id="main-content" className="gh-main">
          <section className="gh-hero" aria-labelledby="hero-title">
            <div className="gh-hero-message">
              <h1 id="hero-title">
                Give your best hours
                <br />
                to what matters.
              </h1>
              <p className="gh-hero-copy">
                Choose an intention. Find your focus.
                <br className="gh-desktop-break" /> Look back at work that feels
                worth your time.
              </p>
              <button
                className="gh-button gh-hero-cta"
                onClick={joinWaitlist}
                type="button"
              >
                Join the waitlist
              </button>
              <p className="gh-platforms">
                Coming to Mac, iOS, Android &amp; Web
              </p>
            </div>
            <section
              ref={artRef}
              className="gh-hero-art"
              aria-label="Interactive focus tool preview"
            >
              <GlassFocus />
              <div
                className="gh-focus-controls"
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest("button")) return;
                  if (
                    window.matchMedia("(prefers-reduced-motion: reduce)")
                      .matches
                  )
                    return;
                  cancelAnimationFrame(returnFrame.current);
                  dragOrigin.current = {
                    x: event.clientX - railPosition.current.x,
                    y: event.clientY - railPosition.current.y,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!dragOrigin.current) return;
                  positionRail(
                    Math.max(
                      -100,
                      Math.min(25, event.clientX - dragOrigin.current.x),
                    ),
                    Math.max(
                      -45,
                      Math.min(45, event.clientY - dragOrigin.current.y),
                    ),
                  );
                }}
                onPointerUp={settleRail}
                onPointerCancel={settleRail}
                onLostPointerCapture={settleRail}
              >
                <div className="gh-rail-reading">
                  <span className="gh-focus-intention">
                    Redesign the editor
                  </span>
                  <span
                    className="gh-demo-time"
                    aria-label={`${minutes} minutes ${remainder} seconds`}
                    role="timer"
                  >
                    {minutes}
                    <span>:</span>
                    {remainder}
                  </span>
                </div>
                <button
                  className="gh-timer-control"
                  aria-label={running ? "Pause focus demo" : "Start focus demo"}
                  onClick={() => setRunning(!running)}
                  type="button"
                >
                  {running ? <PauseIcon /> : <PlayIcon />}
                </button>
              </div>
              <div className="gh-floating-recap">
                <span>A session worth keeping</span>
                <h2>Redesigned the editor</h2>
                <p>
                  Simplified navigation and
                  <br />
                  resolved the empty states.
                </p>
                <a href="#your-day" aria-label="Explore your focus recap">
                  <ArrowRightIcon />
                </a>
              </div>
              <span className="gh-art-caption">
                A little space for
                <br />
                deep work.
              </span>
              <span className="gh-drag-hint">Pull it away. Make it yours.</span>
            </section>
          </section>
        </main>
      </div>
      <section
        className="gh-recap-section"
        id="your-day"
        aria-labelledby="recap-title"
      >
        <div className="gh-recap-intro" data-reveal>
          <h2 id="recap-title">
            Close the day with
            <br />
            something to show for it.
          </h2>
          <p>
            Write a quick recap while it’s fresh.
            <br />
            See what moved forward and where your attention went.
          </p>
        </div>
        <section className="gh-product-stage" aria-label="Explore a sample day">
          <div className="gh-journal">
            <div className="gh-journal-heading">
              <h2>
                Today <span>2 sessions</span>
              </h2>
              <div
                className="gh-journal-tabs"
                role="tablist"
                aria-label="Preview views"
              >
                {(["Session", "Notes", "Recap"] as const).map((label) => (
                  <button
                    key={label}
                    role="tab"
                    id={`tab-${label}`}
                    aria-controls={`panel-${label}`}
                    aria-selected={tab === label}
                    tabIndex={tab === label ? 0 : -1}
                    onClick={() => setTab(label)}
                    onKeyDown={(event) => {
                      const labels: JournalTab[] = [
                        "Session",
                        "Notes",
                        "Recap",
                      ];
                      let next: JournalTab | undefined;
                      if (event.key === "ArrowRight")
                        next =
                          labels[(labels.indexOf(label) + 1) % labels.length];
                      if (event.key === "ArrowLeft")
                        next =
                          labels[
                            (labels.indexOf(label) + labels.length - 1) %
                              labels.length
                          ];
                      if (event.key === "Home") next = "Session";
                      if (event.key === "End") next = "Recap";
                      if (next) {
                        event.preventDefault();
                        setTab(next);
                        document.getElementById(`tab-${next}`)?.focus();
                      }
                    }}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div
              role="tabpanel"
              id={`panel-${tab}`}
              aria-labelledby={`tab-${tab}`}
              className="gh-journal-body"
            >
              {tab === "Recap" && (
                <>
                  {sessions.map((session) => (
                    <details className="gh-session" key={session.title}>
                      <summary>
                        <span className="gh-session-time">
                          {session.time}
                          <small>{session.duration}</small>
                        </span>
                        <span className="gh-session-copy">
                          <strong>{session.title}</strong>
                          <span>{session.summary}</span>
                        </span>
                        <ChevronRightIcon
                          className="gh-session-arrow"
                          aria-hidden="true"
                        />
                      </summary>
                      <p className="gh-session-detail">{session.detail}</p>
                    </details>
                  ))}
                  <details className="gh-reflection">
                    <summary>
                      <span>
                        End-of-day reflection
                        <small>
                          What moved forward, and what deserves attention
                          tomorrow.
                        </small>
                      </span>
                      <ChevronRightIcon aria-hidden="true" />
                    </summary>
                    <p>
                      Less switching. More making. The onboarding is clearer and
                      the prototype is ready to put in someone’s hands.
                      Tomorrow, start with the test.
                    </p>
                  </details>
                </>
              )}
              {tab === "Session" && (
                <div className="gh-current-session">
                  <span className="gh-kicker">ONE THING AT A TIME</span>
                  <h3>Redesign the editor</h3>
                  <p>
                    The next screen. The tricky transition. Enough space to
                    follow the idea through.
                  </p>
                  <button
                    className="gh-text-button"
                    onClick={() => setRunning(!running)}
                    type="button"
                  >
                    {running ? "Pause for a moment" : "Try a focus session"}{" "}
                    {running ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button
                    className="gh-demo-reset"
                    onClick={resetDemo}
                    type="button"
                  >
                    <ResetIcon /> Reset demo
                  </button>
                  <span className="gh-demo-label">
                    An interactive preview. Your real work stays yours.
                  </span>
                </div>
              )}
              {tab === "Notes" && (
                <div className="gh-notes">
                  <label htmlFor="session-note">
                    Leave yourself a thread to pick up.
                  </label>
                  <textarea
                    id="session-note"
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value);
                      setSaved(false);
                    }}
                    maxLength={1000}
                  />
                  <div>
                    <span>Try it here. Notes last for this preview.</span>
                    <button
                      className="gh-text-button"
                      onClick={() => setSaved(true)}
                      type="button"
                    >
                      {saved ? (
                        <>
                          Saved in this preview <CheckIcon />
                        </>
                      ) : (
                        <>
                          Keep this note <ArrowRightIcon />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <p className="gh-preview-caption">
            A glimpse of a day well spent. <span>Try the tabs.</span>
          </p>
        </section>
      </section>

      <section
        className="gh-approach"
        id="our-approach"
        aria-labelledby="approach-title"
      >
        <div data-reveal>
          <p className="gh-kicker">A LITTLE MORE INTENTION</p>
          <h2 id="approach-title">
            Focus now.
            <br />
            <em>Understand later.</em>
          </h2>
          <p className="gh-section-intro">
            Some days are full, but it’s hard to say what they were full of.
            Good Hours makes space for the work you meant to do—and a moment to
            see what came of it.
          </p>
        </div>
        <div className="gh-principles" data-reveal>
          <article>
            <span className="gh-step">01 / BEFORE</span>
            <h3>Choose what matters.</h3>
            <p>
              Name the thing you want to move forward. Give your next stretch of
              attention a place to land.
            </p>
          </article>
          <article>
            <span className="gh-step">02 / DURING</span>
            <h3>Stay with the work.</h3>
            <p>
              A quiet presence at the edge of your day. Room to think, make, get
              stuck, and find your way through.
            </p>
          </article>
          <article>
            <span className="gh-step">03 / AFTER</span>
            <h3>See what it became.</h3>
            <p>
              Keep a little record of what moved forward. Notice what needs
              another hour. Leave tomorrow a starting point.
            </p>
          </article>
        </div>
      </section>

      <section className="gh-manifesto" aria-labelledby="manifesto-title">
        <div className="gh-manifesto-inner" data-reveal>
          <p className="gh-kicker">FOR PEOPLE WHO MAKE THINGS</p>
          <h2 id="manifesto-title">
            Your best work
            <br />
            needs a little <em>space.</em>
          </h2>
          <p>
            For the designer following an idea.
            <br />
            The developer untangling an idea.
            <br />
            Anyone who wants to end the day thinking,
            <br />
            <strong>“That was time well spent.”</strong>
          </p>
          <a className="gh-text-button" href="#waitlist">
            Make room for your good hours <ArrowRightIcon />
          </a>
        </div>
      </section>

      <section className="gh-questions" aria-labelledby="questions-title">
        <div data-reveal>
          <p className="gh-kicker">A FEW THINGS TO KNOW</p>
          <h2 id="questions-title">
            A calmer way
            <br />
            to get into it.
          </h2>
        </div>
        <div className="gh-faq-list" data-reveal>
          <details>
            <summary>
              Who is Good Hours for?
              <ChevronRightIcon aria-hidden="true" />
            </summary>
            <p>
              We’re starting with developers and designers—the people who need
              uninterrupted space to make things. If deep work is part of your
              day, there’s room for you here too.
            </p>
          </details>
          <details>
            <summary>
              Do I have to follow a fixed timer?
              <ChevronRightIcon aria-hidden="true" />
            </summary>
            <p>
              The intention comes first. Good Hours is about giving your work
              attention and understanding what you did with it. You can pause,
              take a breath, and come back.
            </p>
          </details>
          <details>
            <summary>
              Where will I be able to use it?
              <ChevronRightIcon aria-hidden="true" />
            </summary>
            <p>
              We’re planning to launch Mac, iOS, Android, and web together. Join
              the waitlist to hear when everything is ready.
            </p>
          </details>
          <details>
            <summary>
              When can I get it?
              <ChevronRightIcon aria-hidden="true" />
            </summary>
            <p>
              Good Hours is still taking shape. Launch timing and pricing will
              be shared with the waitlist when they’re ready.
            </p>
          </details>
        </div>
      </section>

      <section
        className="gh-waitlist"
        id="waitlist"
        aria-labelledby="waitlist-title"
      >
        <div data-reveal>
          <span className="gh-kicker">LESS SCATTERED. MORE YOURS.</span>
          <h2 id="waitlist-title">
            Here’s to your
            <br />
            <em>next good hour.</em>
          </h2>
          <p>Be there when Good Hours opens its doors.</p>
          <button className="gh-button" onClick={joinWaitlist} type="button">
            Join the waitlist <ArrowRightIcon aria-hidden="true" />
          </button>
          <p className="gh-platforms">Mac · iOS · Android · Web</p>
        </div>
      </section>
      <footer className="gh-footer">
        <a className="gh-wordmark" href="/">
          Good Hours
        </a>
        <span>A little space for your best work.</span>
        <a href="#our-approach">
          Made with intention <ArrowRightIcon aria-hidden="true" />
        </a>
      </footer>
      <dialog
        ref={dialogRef}
        className="gh-waitlist-dialog"
        aria-labelledby="waitlist-dialog-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.close();
        }}
      >
        <button
          className="gh-dialog-close"
          aria-label="Close waitlist information"
          onClick={() => dialogRef.current?.close()}
          type="button"
        >
          <Cross1Icon />
        </button>
        <p className="gh-kicker">GOOD THINGS TAKE A LITTLE TIME</p>
        <h2 id="waitlist-dialog-title">
          We’re making
          <br />
          room for you.
        </h2>
        <p>
          The waitlist is opening soon. Come back for your place when signups
          are ready.
        </p>
        <button
          className="gh-button"
          onClick={() => dialogRef.current?.close()}
          type="button"
        >
          Back to Good Hours
        </button>
      </dialog>
    </div>
  );
}
