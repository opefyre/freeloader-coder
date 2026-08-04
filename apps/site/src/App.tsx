import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { ArrowUpRight } from "@phosphor-icons/react/ArrowUpRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CircleNotch } from "@phosphor-icons/react/CircleNotch";
import { Code } from "@phosphor-icons/react/Code";
import { Copy } from "@phosphor-icons/react/Copy";
import { Cpu } from "@phosphor-icons/react/Cpu";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { List } from "@phosphor-icons/react/List";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { Moon } from "@phosphor-icons/react/Moon";
import { Pause } from "@phosphor-icons/react/Pause";
import { Play } from "@phosphor-icons/react/Play";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Sun } from "@phosphor-icons/react/Sun";
import { TerminalWindow } from "@phosphor-icons/react/TerminalWindow";
import { X } from "@phosphor-icons/react/X";
import { useEffect, useMemo, useState } from "react";

import {
  demoStages,
  documentationUrl,
  issuesUrl,
  publicClaims,
  repositoryUrl,
  securityUrl
} from "./claims.js";

const capabilities = [
  { number: "01", title: "Grounded planning", detail: "Reads bounded repository structure, detects protected paths, and turns intent into a plan you can inspect.", icon: CircleNotch },
  { number: "02", title: "Isolated work", detail: "Keeps generated changes in a separate Git worktree until evidence and your approval justify integration.", icon: TerminalWindow },
  { number: "03", title: "Free-first routing", detail: "Selects eligible free models by capability, quota, privacy class, and circuit health. Local models remain a fallback.", icon: Cpu },
  { number: "04", title: "Evidence before Done", detail: "Tests, builds, diffs, review findings, and receipts—not model confidence—determine completion.", icon: ShieldCheck }
] as const;

const comparisons = [
  ["Execution", "Isolated worktree + explicit apply", "Often direct workspace edits"],
  ["Completion", "Observed validation + review", "Usually model or agent status"],
  ["Provider cost", "$0 automatic-spend lock", "Depends on configured model"],
  ["Recovery", "Durable state + bounded repair", "Session-dependent"],
  ["Human control", "Previewed consequential actions", "Varies by tool"]
] as const;

const faq = [
  ["Is this another code editor?", "No. Pipeline Studio is a control and evidence layer around repositories, models, isolated execution, validation, and human decisions."],
  ["Is every provider actually free?", "No. Free capacity changes by account, region, model, and time. The system probes eligibility and stops rather than silently spending money."],
  ["Does the demo run AI?", "No. It is a deterministic walkthrough of the real product stages and authority boundaries. It never sends data or claims a live result."],
  ["Do I need Docker?", "Not necessarily. The source setup includes guided local paths and supports sandbox options appropriate to the host."],
  ["Who is it for?", "GitHub-capable builders who can clone a repository and review diffs or logs, but do not want to engineer an autonomous coding platform themselves."],
  ["Is the public release complete?", "No. The technical foundation and public preview are live. Field adoption evidence and live paid-provider integrations remain open work."]
] as const;

function ThemeButton() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("pipeline-site-theme", next ? "dark" : "light");
  };
  return <button className="icon-button" type="button" onClick={toggle} aria-label={`Use ${dark ? "light" : "dark"} theme`}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button>;
}

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  const command = "git clone https://github.com/opefyre/freeloader-coder.git";
  const copy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <div className="command"><Code size={18} aria-hidden="true" /><code>{command}</code><button type="button" onClick={copy} aria-label="Copy clone command">{copied ? <CheckCircle size={18} weight="fill" /> : <Copy size={18} />}</button><span className="sr-only" aria-live="polite">{copied ? "Clone command copied" : ""}</span></div>;
}

function Demo() {
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setStage((current) => current === demoStages.length - 1 ? 0 : current + 1), 3200);
    return () => window.clearInterval(timer);
  }, [playing]);
  const current = demoStages[stage] ?? demoStages[0];
  return <section className="section demo-section" id="demo" aria-labelledby="demo-title">
    <div className="section-heading"><div><p className="eyebrow">Interactive product walkthrough</p><h2 id="demo-title">See the control loop, not a magic trick.</h2></div><p>This deterministic demo mirrors the real stages. Nothing is uploaded, executed, or published.</p></div>
    <div className="demo-shell">
      <div className="demo-rail" role="tablist" aria-label="Product walkthrough stages">
        {demoStages.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={stage === index} className={stage === index ? "demo-tab active" : "demo-tab"} onClick={() => { setStage(index); setPlaying(false); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong></button>)}
      </div>
      <div className="demo-stage" role="tabpanel">
        <div className="demo-toolbar"><span className="live-pill"><span /> Guided simulation</span><button type="button" className="icon-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause walkthrough" : "Play walkthrough"}>{playing ? <Pause size={17} /> : <Play size={17} weight="fill" />}</button></div>
        <p className="eyebrow">{current.eyebrow}</p><h3>{current.title}</h3><p className="demo-copy">{current.detail}</p>
        <div className="evidence-card"><div className="evidence-icon"><ShieldCheck size={24} weight="duotone" /></div><div><span>Visible evidence</span><strong>{current.evidence}</strong></div><CheckCircle size={22} weight="fill" /></div>
        <div className="demo-progress" aria-label={`Stage ${stage + 1} of ${demoStages.length}`}>{demoStages.map((item,index)=><span key={item.id} className={index <= stage ? "complete" : ""} />)}</div>
      </div>
    </div>
  </section>;
}

function App() {
  const [menu, setMenu] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const verifiedCount = useMemo(() => publicClaims.filter((claim) => claim.status === "verified").length, []);
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><a className="brand" href="#top" aria-label="Pipeline Studio home"><img src="/pipeline-studio-mark.svg" alt="" /><span><strong>Pipeline Studio</strong><small>Freeloader Coder</small></span></a><nav className={menu ? "site-nav open" : "site-nav"} aria-label="Primary"><a href="#demo">Demo</a><a href="#capabilities">How it works</a><a href="#trust">Trust</a><a href="#compare">Compare</a><a href="#faq">FAQ</a></nav><div className="header-actions"><ThemeButton /><a className="button secondary desktop-action" href={repositoryUrl} target="_blank" rel="noreferrer"><GithubLogo size={18} /> GitHub</a><button className="icon-button menu-button" type="button" aria-expanded={menu} aria-label={menu ? "Close menu" : "Open menu"} onClick={() => setMenu((value) => !value)}>{menu ? <X size={20} /> : <List size={20} />}</button></div></header>
    <main id="main">
      <section className="hero section" id="top"><div className="hero-copy"><a className="status-chip" href="#trust"><span /> Public preview live · field evidence pending <ArrowRight size={15} /></a><p className="eyebrow">Autonomous development with visible proof</p><h1>Build with AI.<br /><em>Keep control.</em></h1><p className="hero-lede">Pipeline Studio turns a request into grounded, isolated, validated code changes—while you keep authority over cost, integration, and publishing.</p><div className="hero-actions"><a className="button primary" href={repositoryUrl} target="_blank" rel="noreferrer"><GithubLogo size={19} weight="fill" /> View source <ArrowUpRight size={17} /></a><a className="button secondary" href="#demo"><Play size={17} weight="fill" /> Explore the demo</a></div><div className="hero-proof"><span><CheckCircle weight="fill" /> Full test suite passing</span><span><LockKey weight="fill" /> $0 automatic spend</span><span><ShieldCheck weight="fill" /> Evidence before Done</span></div></div>
        <div className="hero-visual" aria-label="Illustrative Pipeline Studio evidence flow"><div className="visual-top"><span className="window-dots"><i /><i /><i /></span><span>Illustrative run · no live effect</span><span className="verified"><CheckCircle weight="fill" /> Bounded demo</span></div><div className="visual-request"><span>Your request</span><strong>Add a trustworthy project activity feed</strong></div><div className="visual-flow">{["Grounded plan","Isolated change","Validation","Independent review"].map((item,index)=><div key={item} className="flow-step"><span>{String(index+1).padStart(2,"0")}</span><strong>{item}</strong><CheckCircle size={18} weight="fill" /></div>)}</div><div className="visual-result"><Sparkle size={23} weight="fill" /><div><span>Ready for your decision</span><strong>Preview evidence · local checks · $0.00</strong></div><ArrowRight size={19} /></div></div>
      </section>
      <section className="proof-strip" aria-label="Product facts"><div><strong>Local-first</strong><span>Canonical state stays under your control</span></div><div><strong>Free-first</strong><span>Quotas route; paid use never appears silently</span></div><div><strong>Git-native</strong><span>Isolation, diffs, commits, and rollback</span></div><div><strong>Fail-closed</strong><span>Uncertainty stops with one useful next action</span></div></section>
      <section className="section capabilities" id="capabilities"><div className="section-heading"><div><p className="eyebrow">A complete operating loop</p><h2>More than a chatbot with shell access.</h2></div><p>The orchestration, execution, review, and recovery layers share one canonical record—so every surface tells the same story.</p></div><div className="capability-grid">{capabilities.map(({number,title,detail,icon:Icon})=><article className="capability-card" key={title}><div><span>{number}</span><Icon size={27} weight="duotone" /></div><h3>{title}</h3><p>{detail}</p><a href="#demo">See it in the workflow <ArrowRight size={15} /></a></article>)}</div></section>
      <Demo />
      <section className="section trust-section" id="trust"><div className="trust-intro"><p className="eyebrow">Trust is a product surface</p><h2>Every important claim carries its boundary.</h2><p>Pipeline Studio does not turn roadmap intent into present-tense marketing. Verified, bounded, and unavailable are deliberately different states.</p><div className="trust-count"><strong>{verifiedCount}</strong><span>foundational claims verified against repository evidence</span></div></div><div className="claim-list">{publicClaims.map((claim)=><a className="claim" key={claim.id} href={claim.source} target="_blank" rel="noreferrer"><span className={`claim-status ${claim.status}`}>{claim.status}</span><div><strong>{claim.label}</strong><p>{claim.detail}</p><small>{claim.sourceLabel} <ArrowUpRight size={12} /></small></div></a>)}</div></section>
      <section className="section architecture" aria-labelledby="architecture-title"><div className="section-heading"><div><p className="eyebrow">One evidence chain</p><h2 id="architecture-title">Intent enters. Proof comes out.</h2></div><p>Models can propose. Only deterministic state, policy, validation, review, and explicit authority can advance the work.</p></div><div className="architecture-flow">{[["Intent","Request + repository"],["Brain","Grounding + task graph"],["Workshop","Isolated tools + provider"],["Proof","Validation + review"],["Decision","Keep · restore · publish"]].map(([title,detail],index)=><div className="architecture-node" key={title}><span>{String(index+1).padStart(2,"0")}</span><strong>{title}</strong><small>{detail}</small>{index<4?<ArrowRight className="architecture-arrow" size={21} aria-hidden="true" />:null}</div>)}</div><div className="authority-note"><LockKey size={22} weight="duotone" /><div><strong>The provider never owns the state transition.</strong><span>Consequential actions remain previewed, policy-checked, receipt-backed, and user-controlled.</span></div></div></section>
      <section className="section compare" id="compare"><div className="section-heading"><div><p className="eyebrow">Honest comparison</p><h2>A different default for autonomous work.</h2></div><p>This describes Pipeline Studio’s architecture—not a claim that every alternative lacks safeguards.</p></div><div className="comparison-table" role="table" aria-label="Pipeline Studio architectural comparison"><div className="comparison-row heading" role="row"><span role="columnheader">Dimension</span><span role="columnheader">Pipeline Studio</span><span role="columnheader">Typical agent tooling</span></div>{comparisons.map(([dimension,studio,typical])=><div className="comparison-row" role="row" key={dimension}><strong role="cell">{dimension}</strong><span role="cell"><CheckCircle size={17} weight="fill" />{studio}</span><span role="cell">{typical}</span></div>)}</div></section>
      <section className="section source-section"><div><p className="eyebrow">Source-first adoption</p><h2>Clone it. Inspect it. Decide for yourself.</h2><p>No installer claim and no hidden hosted account. Start from the repository, review the safeguards, and run the documented setup on your own machine.</p><CopyCommand /><div className="source-links"><a href={documentationUrl} target="_blank" rel="noreferrer">Read documentation <ArrowUpRight size={14} /></a><a href={securityUrl} target="_blank" rel="noreferrer">Security policy <ArrowUpRight size={14} /></a><a href={issuesUrl} target="_blank" rel="noreferrer">Issues and feedback <ArrowUpRight size={14} /></a></div></div><div className="source-card"><img src="/pipeline-studio-mark.svg" alt="" /><span>Public source</span><strong>opefyre/freeloader-coder</strong><p>Node 22+ · npm workspaces · local-first</p><a className="button primary" href={repositoryUrl} target="_blank" rel="noreferrer"><GithubLogo size={18} weight="fill" /> Open repository</a></div></section>
      <section className="section faq" id="faq"><div className="section-heading"><div><p className="eyebrow">Before you clone</p><h2>Clear answers, including the inconvenient ones.</h2></div></div><div className="faq-list">{faq.map(([question,answer],index)=><div className="faq-item" key={question}><button type="button" aria-expanded={openFaq===index} onClick={()=>setOpenFaq(openFaq===index?null:index)}><strong>{question}</strong><span>{openFaq===index?<X size={18}/>:<ArrowRight size={18}/>}</span></button>{openFaq===index?<p>{answer}</p>:null}</div>)}</div></section>
      <section className="final-cta section"><img src="/pipeline-studio-mark.svg" alt="" /><p className="eyebrow">Built in the open</p><h2>Make the work autonomous.<br />Keep the authority human.</h2><p>The public preview is live. Explore the source today; real adoption evidence still comes next.</p><div><a className="button primary" href={repositoryUrl} target="_blank" rel="noreferrer"><GithubLogo size={19} weight="fill" /> View on GitHub</a><a className="button secondary" href="#demo">Replay the demo</a></div></section>
    </main>
    <footer><a className="brand" href="#top"><img src="/pipeline-studio-mark.svg" alt="" /><span><strong>Pipeline Studio</strong><small>Freeloader Coder</small></span></a><p>Local-first autonomous development with evidence and control.</p><nav aria-label="Footer"><a href={repositoryUrl}>Source</a><a href={documentationUrl}>Docs</a><a href={securityUrl}>Security</a><a href={issuesUrl}>Feedback</a></nav><small>Public site foundation · No analytics · No paid calls · No external writes</small></footer>
  </>;
}

export { App };
