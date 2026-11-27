/**
 * 全局智能体浏览器宿主。
 *
 * 它常驻在 App 根部，不随智能体页签关闭而卸载；每个 session 一枚 webview。
 * Dock 只把「当前要展示哪一枚、展示在屏幕哪个矩形」写入 runtime，这里按矩形定位。
 * 收起时只是移出屏幕/隐藏，guest 继续在后台运行。
 */
import { agentBrowserRuntime, useAgentBrowserSnapshot } from '../../../learn/web/agentBrowser'
import AgentBrowserWebview from './AgentBrowserWebview'

export default function AgentBrowserHost() {
  const snapshot = useAgentBrowserSnapshot()
  if (snapshot.sessions.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 35 }} data-agent-browser-host>
      {snapshot.sessions.map((session) => {
        const vp = snapshot.viewport?.sessionId === session.sessionId ? snapshot.viewport : null
        const visible = !!vp?.visible && vp.rect.width > 0 && vp.rect.height > 0
        return (
          <div
            key={session.sessionId}
            style={{ position: 'fixed', inset: 0, zIndex: 35, pointerEvents: 'none' }}
          >
            <AgentBrowserWebview
              sessionId={session.sessionId}
              url={session.url}
              interactive={session.control === 'user'}
              style={{
                position: 'fixed',
                left: visible ? Math.round(vp.rect.x) : -10000,
                top: visible ? Math.round(vp.rect.y) : 0,
                width: visible ? Math.max(1, Math.round(vp.rect.width)) : 640,
                height: visible ? Math.max(1, Math.round(vp.rect.height)) : 480,
                visibility: visible ? 'visible' : 'hidden',
                zIndex: 35,
                border: 0,
                background: '#fff',
              }}
            />
            {visible && session.control !== 'user' ? (
              // 观看/执行态的点击盾：点页面即接管。不能只靠 webview 的 pointerEvents，
              // Electron guest 的命中测试在部分平台会绕过 CSS，盾必须压在它上面。
              <div
                title="点击接管浏览器"
                onClick={() => agentBrowserRuntime.setControl(session.sessionId, 'user')}
                style={{
                  position: 'fixed',
                  left: Math.round(vp.rect.x),
                  top: Math.round(vp.rect.y),
                  width: Math.max(1, Math.round(vp.rect.width)),
                  height: Math.max(1, Math.round(vp.rect.height)),
                  zIndex: 36,
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  background: 'transparent',
                }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
