import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import type { AndroidDevice } from "../shared/types";

const MAX_OUTPUT_CHARS = 200_000;
const FLUSH_INTERVAL_MS = 100;
const HISTORY_CAP = 50;
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function deviceLabel(device: AndroidDevice): string {
  return device.model?.replaceAll("_", " ") || device.product || device.serial;
}

export function TerminalPane({
  device,
  active,
  onClose
}: {
  device: AndroidDevice;
  active: boolean;
  onClose: () => void;
}) {
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("正在连接…");
  const pendingRef = useRef("");
  const outputRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = window.androidTool.onTerminalEvent((event) => {
      if (event.serial !== device.serial) return;
      if (event.type === "data") {
        // 去掉设备输出的 ANSI 控制序列，保持纯文本
        pendingRef.current += event.data.replace(ANSI_PATTERN, "");
      } else {
        setRunning(event.running);
        setStatus(event.message || (event.running ? "已连接" : "会话已结束"));
      }
    });

    const flushTimer = window.setInterval(() => {
      if (!pendingRef.current) return;
      const chunk = pendingRef.current;
      pendingRef.current = "";
      setOutput((current) => (current + chunk).slice(-MAX_OUTPUT_CHARS));
    }, FLUSH_INTERVAL_MS);

    void window.androidTool.startTerminal(device.serial).then((result) => {
      if (!result.ok) setStatus(result.message || "终端启动失败");
    });

    return () => {
      window.clearInterval(flushTimer);
      unsubscribe();
      void window.androidTool.stopTerminal(device.serial);
    };
  }, [device.serial]);

  // 终端习惯上始终跟随底部
  useEffect(() => {
    const el = outputRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [output]);

  // 切回该 Tab 时聚焦输入框
  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  function echo(line: string): void {
    pendingRef.current += line;
  }

  function submit(): void {
    const command = input.trim();
    if (!command || !running) return;
    echo(`$ ${command}\n`);
    window.androidTool.sendTerminalInput(device.serial, `${command}\n`);
    const history = historyRef.current;
    if (history[history.length - 1] !== command) {
      history.push(command);
      if (history.length > HISTORY_CAP) history.shift();
    }
    historyIndexRef.current = -1;
    setInput("");
  }

  function sendBreak(): void {
    if (!running) return;
    echo("^C\n");
    window.androidTool.sendTerminalInput(device.serial, "\x03");
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
      return;
    }
    const history = historyRef.current;
    if (event.key === "ArrowUp" && history.length > 0) {
      event.preventDefault();
      const next =
        historyIndexRef.current === -1
          ? history.length - 1
          : Math.max(0, historyIndexRef.current - 1);
      historyIndexRef.current = next;
      setInput(history[next]);
      return;
    }
    if (event.key === "ArrowDown" && historyIndexRef.current !== -1) {
      event.preventDefault();
      const next = historyIndexRef.current + 1;
      if (next >= history.length) {
        historyIndexRef.current = -1;
        setInput("");
      } else {
        historyIndexRef.current = next;
        setInput(history[next]);
      }
    }
  }

  return (
    <section className={active ? "terminal-pane" : "terminal-pane pane-hidden"}>
      <header className="terminal-header">
        <div>
          <strong>{deviceLabel(device)}</strong>
          <code>{device.serial}</code>
        </div>
        <span className={running ? "terminal-state on" : "terminal-state"}>
          {status}
        </span>
        <button className="terminal-clear" onClick={() => setOutput("")}>
          清屏
        </button>
        <button className="terminal-close" onClick={onClose} title="关闭终端">
          ×
        </button>
      </header>

      <div className="terminal-output" ref={outputRef}>
        {output || (
          <span className="terminal-placeholder">
            正在连接设备 shell…输入命令后按 Enter 执行
          </span>
        )}
      </div>

      <div className="terminal-input">
        <span className="terminal-prompt">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            running ? "输入 shell 命令，Enter 执行，↑↓ 翻历史" : "会话未连接"
          }
          disabled={!running}
          spellCheck={false}
          autoFocus
        />
        <button onClick={sendBreak} title="发送 Ctrl+C 中断当前命令">
          ^C
        </button>
      </div>
    </section>
  );
}
