import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  CircleHelp,
  LayoutDashboard,
  Menu,
  X,
} from "lucide-react";

export type View = "predictions" | "insights" | "tracking";

export default function Sidebar({
  view,
  navigate,
  help,
  online,
}: {
  view: View;
  navigate: (view: View) => void;
  help: () => void;
  online: boolean;
}) {
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) drawer.current?.showModal();
    else drawer.current?.close();
  }, [open]);

  function select(next: View) {
    setOpen(false);
    navigate(next);
  }

  return (
    <>
      <button
        className="icon-button navigation-toggle"
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="navigation-drawer"
        onClick={() => setOpen((value) => !value)}
      >
        <Menu size={24} />
      </button>
      <dialog
        id="navigation-drawer"
        className="sidebar"
        ref={drawer}
        aria-label="Navigation"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === drawer.current) {
            const bounds = drawer.current.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              setOpen(false);
          }
        }}
      >
        <div className="sidebar-header">
          <a className="brand" href="/ui/" aria-label="Courtside home">
            <span>
              courtside<span className="brand-dot">.</span>
            </span>
          </a>
          <button
            className="icon-button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            autoFocus
          >
            <X size={24} />
          </button>
        </div>
        <nav aria-label="Main navigation">
          <button
            className={view === "predictions" ? "active" : ""}
            aria-current={view === "predictions" ? "page" : undefined}
            onClick={() => select("predictions")}
          >
            <LayoutDashboard size={21} />
            Player predictions
          </button>
          <button
            className={view === "insights" ? "active" : ""}
            aria-current={view === "insights" ? "page" : undefined}
            onClick={() => select("insights")}
          >
            <BarChart3 size={21} />
            Model insights
          </button>
          <button
            className={view === "tracking" ? "active" : ""}
            aria-current={view === "tracking" ? "page" : undefined}
            onClick={() => select("tracking")}
          >
            <Activity size={21} />
            Forecast history
          </button>
          <button
            onClick={() => {
              setOpen(false);
              help();
            }}
          >
            <CircleHelp size={21} />
            How it works
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className={`connection-dot ${online ? "connected" : ""}`} />
          {online ? "Online" : "Connecting…"}
          <a href="/docs">API docs</a>
        </div>
      </dialog>
    </>
  );
}
