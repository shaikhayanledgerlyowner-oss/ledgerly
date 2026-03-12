import { useEffect, useRef } from "react";

export default function Index() {
  const mockupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("visible");
        });
      },
      { threshold: 0.1 }
    );
    document.querySelectorAll(".fade-up").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --ink: #0f0e0c;
          --paper: #faf8f4;
          --cream: #f2ede3;
          --sage: #4a7c59;
          --sage-light: #6b9e7a;
          --sage-dim: #d4e6da;
          --gold: #c8a84b;
          --muted: #7a7369;
          --border: #e2ddd4;
        }

        body { font-family: 'DM Sans', sans-serif; background: var(--paper); color: var(--ink); overflow-x: hidden; }

        /* NAV */
        .ld-nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between;
          padding: 1.1rem 3rem;
          background: rgba(250,248,244,0.88);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
        }
        .ld-logo { font-family: 'Instrument Serif', serif; font-size: 1.5rem; color: var(--ink); text-decoration: none; letter-spacing: -0.02em; }
        .ld-logo span { color: var(--sage); }
        .ld-nav-links { display: flex; gap: 2rem; list-style: none; }
        .ld-nav-links a { color: var(--muted); text-decoration: none; font-size: 0.9rem; font-weight: 500; transition: color .2s; }
        .ld-nav-links a:hover { color: var(--ink); }
        .ld-nav-cta {
          background: var(--sage); color: #fff; border: none; padding: .6rem 1.4rem;
          border-radius: 8px; font-size: .9rem; font-weight: 600; cursor: pointer;
          text-decoration: none; transition: background .2s, transform .15s;
        }
        .ld-nav-cta:hover { background: var(--sage-light); transform: translateY(-1px); }

        /* HERO */
        .ld-hero {
          min-height: 100vh; display: flex; align-items: center;
          padding: 8rem 3rem 4rem; position: relative; overflow: hidden;
        }
        .ld-hero-bg {
          position: absolute; inset: 0; z-index: 0;
          background:
            radial-gradient(ellipse 70% 60% at 80% 20%, rgba(74,124,89,0.08) 0%, transparent 60%),
            radial-gradient(ellipse 50% 50% at 20% 80%, rgba(200,168,75,0.06) 0%, transparent 55%);
        }
        .ld-hero-grid {
          position: absolute; inset: 0; z-index: 0; opacity: 0.03;
          background-image: linear-gradient(var(--ink) 1px, transparent 1px), linear-gradient(90deg, var(--ink) 1px, transparent 1px);
          background-size: 40px 40px;
        }
        .ld-hero-inner {
          position: relative; z-index: 1; max-width: 1200px; margin: 0 auto;
          display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center;
        }
        .ld-tag {
          display: inline-flex; align-items: center; gap: .5rem;
          background: var(--sage-dim); color: var(--sage);
          padding: .35rem .9rem; border-radius: 100px;
          font-size: .8rem; font-weight: 600; letter-spacing: .04em;
          text-transform: uppercase; margin-bottom: 1.4rem;
        }
        .ld-tag::before { content: '●'; font-size: .5rem; }
        .ld-h1 {
          font-family: 'Instrument Serif', serif;
          font-size: clamp(2.8rem, 5vw, 4.2rem);
          line-height: 1.1; letter-spacing: -0.03em; margin-bottom: 1.4rem;
        }
        .ld-h1 em { color: var(--sage); font-style: italic; }
        .ld-hero-sub { font-size: 1.1rem; color: var(--muted); line-height: 1.7; max-width: 460px; margin-bottom: 2.2rem; }
        .ld-hero-actions { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
        .ld-btn-primary {
          background: var(--ink); color: var(--paper); padding: .85rem 2rem; border-radius: 10px;
          font-size: 1rem; font-weight: 600; text-decoration: none; border: none; cursor: pointer;
          transition: background .2s, transform .15s, box-shadow .2s;
          box-shadow: 0 4px 16px rgba(15,14,12,0.18);
        }
        .ld-btn-primary:hover { background: #2a2824; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(15,14,12,0.22); }
        .ld-btn-secondary {
          color: var(--ink); text-decoration: none; font-size: .95rem; font-weight: 500;
          display: flex; align-items: center; gap: .4rem;
          border-bottom: 1px solid var(--border); padding-bottom: .1rem;
          transition: border-color .2s, color .2s;
        }
        .ld-btn-secondary:hover { color: var(--sage); border-color: var(--sage); }
        .ld-trust { margin-top: 2.5rem; display: flex; align-items: center; gap: 1rem; font-size: .82rem; color: var(--muted); }
        .ld-trust-dots { display: flex; }
        .ld-trust-dot {
          width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--paper);
          background: var(--sage-dim); margin-left: -6px; display: flex; align-items: center;
          justify-content: center; font-size: .65rem; font-weight: 700; color: var(--sage);
        }

        /* MOCKUP */
        .ld-mockup { position: relative; }
        .ld-mockup-card {
          background: #fff; border: 1px solid var(--border); border-radius: 16px;
          box-shadow: 0 20px 60px rgba(15,14,12,0.12), 0 4px 16px rgba(15,14,12,0.06);
          overflow: hidden;
          transform: perspective(1000px) rotateY(-4deg) rotateX(2deg);
          transition: transform .4s ease;
        }
        .ld-mockup-card:hover { transform: perspective(1000px) rotateY(0deg) rotateX(0deg); }
        .ld-topbar {
          background: #f8f7f5; border-bottom: 1px solid var(--border);
          padding: .7rem 1rem; display: flex; align-items: center; gap: .5rem;
        }
        .ld-dot { width: 10px; height: 10px; border-radius: 50%; }
        .ld-url {
          margin-left: .5rem; flex: 1; background: #ede9e0; border-radius: 6px;
          padding: .25rem .7rem; font-size: .72rem; color: var(--muted);
        }
        .ld-mbody { padding: 1.2rem; }
        .ld-mheader { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .ld-mtitle { font-family: 'Instrument Serif', serif; font-size: 1.1rem; }
        .ld-mbadge { background: var(--sage-dim); color: var(--sage); padding: .2rem .6rem; border-radius: 6px; font-size: .7rem; font-weight: 600; }
        .ld-stats { display: grid; grid-template-columns: repeat(3,1fr); gap: .7rem; margin-bottom: 1rem; }
        .ld-stat { background: var(--cream); border-radius: 10px; padding: .8rem; border: 1px solid var(--border); }
        .ld-stat-label { font-size: .65rem; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: .05em; }
        .ld-stat-val { font-size: 1.15rem; font-weight: 700; margin-top: .2rem; }
        .ld-stat-val.green { color: var(--sage); }
        .ld-table { width: 100%; border-collapse: collapse; font-size: .72rem; }
        .ld-table th { background: var(--cream); padding: .4rem .6rem; text-align: left; font-weight: 600; color: var(--muted); font-size: .65rem; text-transform: uppercase; letter-spacing: .04em; }
        .ld-table td { padding: .45rem .6rem; border-bottom: 1px solid var(--border); }
        .ld-table tr:last-child td { border-bottom: none; }
        .ld-pill { padding: .15rem .5rem; border-radius: 100px; font-size: .6rem; font-weight: 600; }
        .ld-paid { background: #d4e6da; color: var(--sage); }
        .ld-pending { background: #fef3c7; color: #92400e; }
        .ld-float1 {
          position: absolute; bottom: -1rem; left: -1.5rem;
          background: #fff; border: 1px solid var(--border); border-radius: 12px;
          padding: .7rem 1rem; box-shadow: 0 8px 24px rgba(15,14,12,0.1);
          display: flex; align-items: center; gap: .6rem;
          font-size: .78rem; font-weight: 600; white-space: nowrap;
          animation: floatY 3s ease-in-out infinite;
        }
        .ld-float2 {
          position: absolute; top: 1rem; right: -1rem;
          background: var(--sage); color: #fff; border-radius: 12px;
          padding: .6rem .9rem; box-shadow: 0 8px 24px rgba(74,124,89,0.3);
          font-size: .75rem; font-weight: 600;
          animation: floatY 3s ease-in-out infinite .8s;
        }
        @keyframes floatY { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

        /* LOGOS */
        .ld-logos { padding: 2.5rem 3rem; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--cream); }
        .ld-logos-inner { max-width: 1000px; margin: 0 auto; display: flex; align-items: center; justify-content: center; gap: 3rem; flex-wrap: wrap; }
        .ld-logos-label { font-size: .8rem; color: var(--muted); font-weight: 500; white-space: nowrap; }
        .ld-logo-item { font-family: 'Instrument Serif', serif; font-size: 1.1rem; color: #b0a898; }

        /* SECTIONS */
        .ld-section { padding: 6rem 3rem; }
        .ld-section-inner { max-width: 1100px; margin: 0 auto; }
        .ld-section-tag { font-size: .78rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--sage); margin-bottom: .8rem; }
        .ld-section-title { font-family: 'Instrument Serif', serif; font-size: clamp(2rem, 3.5vw, 3rem); letter-spacing: -0.03em; line-height: 1.15; margin-bottom: 1rem; }
        .ld-section-sub { color: var(--muted); font-size: 1.05rem; line-height: 1.7; max-width: 520px; }

        /* STEPS */
        .ld-steps { display: grid; grid-template-columns: repeat(3,1fr); gap: 1.5rem; margin-top: 3.5rem; }
        .ld-step {
          background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 2rem;
          transition: transform .25s, box-shadow .25s;
        }
        .ld-step:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(15,14,12,0.1); }
        .ld-step-num { font-family: 'Instrument Serif', serif; font-size: 3.5rem; color: var(--border); line-height: 1; margin-bottom: .8rem; font-style: italic; }
        .ld-step-icon { width: 44px; height: 44px; background: var(--sage-dim); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; margin-bottom: 1rem; }
        .ld-step-title { font-weight: 700; font-size: 1.05rem; margin-bottom: .5rem; }
        .ld-step-desc { color: var(--muted); font-size: .9rem; line-height: 1.6; }

        /* FEATURES */
        .ld-features { background: var(--ink); color: var(--paper); padding: 6rem 3rem; }
        .ld-features-inner { max-width: 1100px; margin: 0 auto; }
        .ld-feat-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 1px; margin-top: 3rem; background: #2a2824; border: 1px solid #2a2824; border-radius: 20px; overflow: hidden; }
        .ld-feat { background: #1a1916; padding: 2.5rem; transition: background .2s; }
        .ld-feat:hover { background: #201f1c; }
        .ld-feat-icon { font-size: 2rem; margin-bottom: 1rem; }
        .ld-feat-title { font-weight: 700; font-size: 1.1rem; margin-bottom: .5rem; color: var(--paper); }
        .ld-feat-desc { color: #7a7369; font-size: .9rem; line-height: 1.65; }
        .ld-feat-hl { color: var(--sage-light); font-weight: 600; }

        /* TESTIMONIALS */
        .ld-testi { padding: 6rem 3rem; background: var(--cream); }
        .ld-testi-inner { max-width: 1100px; margin: 0 auto; }
        .ld-testi-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 1.5rem; margin-top: 3rem; }
        .ld-testi-card {
          background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 1.8rem;
          display: flex; flex-direction: column; gap: 1rem;
          transition: transform .25s, box-shadow .25s;
        }
        .ld-testi-card:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(15,14,12,0.08); }
        .ld-stars { color: var(--gold); font-size: 1rem; letter-spacing: .1em; }
        .ld-testi-text { font-size: .92rem; line-height: 1.7; font-style: italic; }
        .ld-author { display: flex; align-items: center; gap: .8rem; margin-top: auto; }
        .ld-avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--sage-dim); display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--sage); font-size: .8rem; }
        .ld-author-name { font-weight: 600; font-size: .88rem; }
        .ld-author-role { font-size: .78rem; color: var(--muted); }

        /* PRICING */
        .ld-pricing { padding: 6rem 3rem; }
        .ld-pricing-inner { max-width: 1100px; margin: 0 auto; text-align: center; }
        .ld-price-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1.5rem; margin-top: 3rem; text-align: left; }
        .ld-price-card { border: 1px solid var(--border); border-radius: 20px; padding: 2.5rem; background: #fff; transition: transform .25s, box-shadow .25s; }
        .ld-price-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(15,14,12,0.1); }
        .ld-price-card.popular { border-color: var(--sage); border-width: 2px; background: linear-gradient(135deg,#fff 0%,#f2f8f4 100%); position: relative; }
        .ld-popular-badge {
          position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
          background: var(--sage); color: #fff; padding: .3rem 1rem; border-radius: 100px;
          font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap;
        }
        .ld-tier { font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: .8rem; }
        .ld-tier.green { color: var(--sage); }
        .ld-amount { font-family: 'Instrument Serif', serif; font-size: 3rem; line-height: 1; letter-spacing: -0.03em; }
        .ld-amount span { font-family: 'DM Sans', sans-serif; font-size: 1rem; font-weight: 400; color: var(--muted); }
        .ld-price-desc { color: var(--muted); font-size: .88rem; margin: .8rem 0 1.5rem; line-height: 1.5; }
        .ld-price-list { list-style: none; display: flex; flex-direction: column; gap: .7rem; margin-bottom: 2rem; }
        .ld-price-list li { font-size: .88rem; display: flex; align-items: center; gap: .6rem; }
        .ld-price-list li::before { content: '✓'; color: var(--sage); font-weight: 700; }
        .ld-price-list li.dim { color: var(--muted); }
        .ld-price-list li.dim::before { content: '—'; color: var(--border); }
        .ld-btn-plan { width: 100%; padding: .85rem; border-radius: 10px; font-size: .95rem; font-weight: 600; cursor: pointer; border: none; text-decoration: none; display: block; text-align: center; transition: all .2s; }
        .ld-btn-outline { background: transparent; border: 1.5px solid var(--border); color: var(--ink); }
        .ld-btn-outline:hover { border-color: var(--ink); }
        .ld-btn-filled { background: var(--sage); color: #fff; }
        .ld-btn-filled:hover { background: var(--sage-light); transform: translateY(-1px); }

        /* CTA */
        .ld-cta {
          margin: 0 3rem 5rem; background: var(--ink); color: var(--paper);
          border-radius: 24px; padding: 5rem 4rem; text-align: center; position: relative; overflow: hidden;
        }
        .ld-cta::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse 60% 80% at 50% -20%, rgba(74,124,89,0.3) 0%, transparent 60%); }
        .ld-cta-inner { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; }
        .ld-cta h2 { font-family: 'Instrument Serif', serif; font-size: clamp(2rem, 4vw, 3.2rem); letter-spacing: -0.03em; line-height: 1.1; color: var(--paper); margin-bottom: 1.2rem; }
        .ld-cta p { color: #9e9890; font-size: 1rem; line-height: 1.7; margin-bottom: 2rem; }
        .ld-cta-btns { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
        .ld-btn-cta-main { background: var(--sage); color: #fff; padding: .9rem 2.2rem; border-radius: 10px; font-size: 1rem; font-weight: 600; text-decoration: none; transition: background .2s, transform .15s; }
        .ld-btn-cta-main:hover { background: var(--sage-light); transform: translateY(-2px); }
        .ld-btn-cta-ghost { border: 1.5px solid #3a3830; color: #9e9890; padding: .9rem 2.2rem; border-radius: 10px; font-size: 1rem; font-weight: 600; text-decoration: none; transition: border-color .2s, color .2s; }
        .ld-btn-cta-ghost:hover { border-color: #6a6458; color: var(--paper); }

        /* FOOTER */
        .ld-footer { padding: 2.5rem 3rem; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
        .ld-footer-logo { font-family: 'Instrument Serif', serif; font-size: 1.2rem; }
        .ld-footer-logo span { color: var(--sage); }
        .ld-footer-links { display: flex; gap: 1.8rem; }
        .ld-footer-links a { font-size: .85rem; color: var(--muted); text-decoration: none; transition: color .2s; }
        .ld-footer-links a:hover { color: var(--ink); }
        .ld-footer-copy { font-size: .8rem; color: var(--muted); }

        /* FADE UP */
        .fade-up { opacity: 0; transform: translateY(24px); transition: opacity .6s ease, transform .6s ease; }
        .fade-up.visible { opacity: 1; transform: translateY(0); }
        .fade-up.d1 { transition-delay: .1s; }
        .fade-up.d2 { transition-delay: .22s; }
        .fade-up.d3 { transition-delay: .34s; }
        .fade-up.d4 { transition-delay: .46s; }
        .fade-up.d5 { transition-delay: .58s; }

        /* RESPONSIVE */
        @media(max-width: 900px) {
          .ld-nav { padding: 1rem 1.5rem; }
          .ld-nav-links { display: none; }
          .ld-hero { padding: 6rem 1.5rem 3rem; }
          .ld-hero-inner { grid-template-columns: 1fr; }
          .ld-mockup { display: none; }
          .ld-section, .ld-features, .ld-testi, .ld-pricing { padding: 4rem 1.5rem; }
          .ld-steps, .ld-feat-grid, .ld-testi-grid, .ld-price-grid { grid-template-columns: 1fr; }
          .ld-price-card.popular { margin-top: 0; }
          .ld-cta { margin: 0 1.5rem 3rem; padding: 3.5rem 2rem; }
          .ld-footer { padding: 2rem 1.5rem; flex-direction: column; text-align: center; }
        }
      `}</style>

      {/* NAV */}
      <nav className="ld-nav">
        <a href="/" className="ld-logo">Ledger<span>ly</span></a>
        <ul className="ld-nav-links">
          <li><a href="#how">How it works</a></li>
          <li><a href="#features">Features</a></li>
          <li><a href="#pricing">Pricing</a></li>
        </ul>
        <a href="/auth" className="ld-nav-cta">Start Free →</a>
      </nav>

      {/* HERO */}
      <section className="ld-hero">
        <div className="ld-hero-bg" />
        <div className="ld-hero-grid" />
        <div className="ld-hero-inner">
          <div>
            <div className="ld-tag fade-up">For Small Businesses</div>
            <h1 className="ld-h1 fade-up d1">Your business,<br /><em>brilliantly</em><br />organised.</h1>
            <p className="ld-hero-sub fade-up d2">Smart ledger, professional invoices, quotations & PDF tools — everything your business needs, in one clean workspace.</p>
            <div className="ld-hero-actions fade-up d3">
              <a href="/auth" className="ld-btn-primary">Get Started Free</a>
              <a href="#how" className="ld-btn-secondary">See how it works ↓</a>
            </div>
            <div className="ld-trust fade-up d4">
              <div className="ld-trust-dots">
                {["R","S","M","A"].map((l) => <div key={l} className="ld-trust-dot">{l}</div>)}
              </div>
              <span>Trusted by small business owners across India</span>
            </div>
          </div>

          {/* MOCKUP */}
          <div className="ld-mockup fade-up d5" ref={mockupRef}>
            <div className="ld-mockup-card">
              <div className="ld-topbar">
                <div className="ld-dot" style={{background:"#ff6058"}} />
                <div className="ld-dot" style={{background:"#ffbd2e"}} />
                <div className="ld-dot" style={{background:"#28c840"}} />
                <div className="ld-url">ledgerly-smart-manage.vercel.app</div>
              </div>
              <div className="ld-mbody">
                <div className="ld-mheader">
                  <div className="ld-mtitle">March 2025</div>
                  <div className="ld-mbadge">Premium ✦</div>
                </div>
                <div className="ld-stats">
                  <div className="ld-stat"><div className="ld-stat-label">Revenue</div><div className="ld-stat-val green">₹5,400</div></div>
                  <div className="ld-stat"><div className="ld-stat-label">Expenses</div><div className="ld-stat-val">₹0</div></div>
                  <div className="ld-stat"><div className="ld-stat-label">Net</div><div className="ld-stat-val green">₹5,400</div></div>
                </div>
                <table className="ld-table">
                  <thead><tr><th>Date</th><th>Name</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {[
                      ["12 Mar","Rahul S.","₹1,200","paid"],
                      ["11 Mar","Priya M.","₹900","paid"],
                      ["10 Mar","Arun K.","₹2,100","pending"],
                      ["09 Mar","Sunita D.","₹1,200","paid"],
                    ].map(([d,n,a,s]) => (
                      <tr key={n}>
                        <td>{d}</td><td>{n}</td><td>{a}</td>
                        <td><span className={`ld-pill ${s === "paid" ? "ld-paid" : "ld-pending"}`}>{s === "paid" ? "Paid" : "Pending"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="ld-float1">📄 PDF exported!</div>
            <div className="ld-float2">📊 EasyCount™</div>
          </div>
        </div>
      </section>

      {/* LOGOS */}
      <div className="ld-logos">
        <div className="ld-logos-inner">
          <span className="ld-logos-label">Used by businesses in</span>
          {["Diagnostics","Retail","Clinics","Freelancers","Wholesalers","Services"].map((l) => (
            <span key={l} className="ld-logo-item">{l}</span>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section className="ld-section" id="how">
        <div className="ld-section-inner">
          <div className="ld-section-tag">How it works</div>
          <h2 className="ld-section-title">Up and running<br />in minutes.</h2>
          <p className="ld-section-sub">No accountant needed. No complex software. Just sign up and start managing your business like a pro.</p>
          <div className="ld-steps">
            {[
              ["01","🔐","Create your account","Sign up for free in under 30 seconds. Your data stays private and secure — no one else can see it."],
              ["02","📋","Add your records","Create tables, log transactions, and manage entries just like Excel — but smarter, faster, and in the cloud."],
              ["03","🚀","Invoice & export","Generate professional invoices, quotations, and bills in one click. Export to PDF or Excel instantly."],
            ].map(([n,i,t,d]) => (
              <div key={t} className="ld-step">
                <div className="ld-step-num">{n}</div>
                <div className="ld-step-icon">{i}</div>
                <div className="ld-step-title">{t}</div>
                <div className="ld-step-desc">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="ld-features" id="features">
        <div className="ld-features-inner">
          <div className="ld-section-tag" style={{color:"var(--sage-light)"}}>Features</div>
          <h2 className="ld-section-title" style={{color:"var(--paper)"}}>Everything your business<br />actually needs.</h2>
          <p className="ld-section-sub" style={{color:"#9e9890"}}>Built specifically for Indian small businesses — no bloat, no complexity.</p>
          <div className="ld-feat-grid">
            {[
              ["📊","Smart Ledger Tables",<>Excel-like tables with <span className="ld-feat-hl">EasyCount™</span> formula support, custom styling, undo/redo, and bulk row/column management.</>],
              ["🧾","Professional Invoices","Create branded invoices, quotations, and bills in seconds. Auto-calculate totals, add your logo, and share directly with clients."],
              ["📁","One-Click PDF Export","Export any table or document to a clean, professional PDF or Excel file. Perfect for sharing with accountants or filing records."],
              ["📈","Dashboard Overview","See your revenue, expenses, and net balance at a glance. Visual charts and quick summaries keep you always in control."],
              ["🔒","Private & Secure","Your financial data is encrypted and visible only to you. We don't sell your data, ever. Built with enterprise-grade security."],
              ["⚡","Fast & Mobile-Ready","Works seamlessly on mobile, tablet, and desktop. Lightning-fast loading — manage your business from anywhere, anytime."],
            ].map(([icon,title,desc]) => (
              <div key={title as string} className="ld-feat">
                <div className="ld-feat-icon">{icon}</div>
                <div className="ld-feat-title">{title}</div>
                <div className="ld-feat-desc">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="ld-testi">
        <div className="ld-testi-inner">
          <div className="ld-section-tag">Testimonials</div>
          <h2 className="ld-section-title">Loved by business<br />owners like you.</h2>
          <div className="ld-testi-grid">
            {[
              ["RK","Ramesh Kumar","Medical Diagnostics, Pune","Pehle Excel mein sab kuch manually karta tha. Ab Ledgerly se invoices aur tables dono ek jagah ho jaate hain. Time bahut bachta hai!"],
              ["SP","Sneha Patel","Freelance Designer, Ahmedabad","The PDF export feature is a game changer. I send professional-looking bills to clients now and they're always impressed."],
              ["AJ","Arjun Joshi","Wholesale Trader, Mumbai","EasyCount formula support is incredible. I track daily cash and online payments separately — exactly what my shop needed."],
            ].map(([av,name,role,text]) => (
              <div key={name as string} className="ld-testi-card">
                <div className="ld-stars">★★★★★</div>
                <div className="ld-testi-text">"{text}"</div>
                <div className="ld-author">
                  <div className="ld-avatar">{av}</div>
                  <div><div className="ld-author-name">{name}</div><div className="ld-author-role">{role}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="ld-pricing" id="pricing">
        <div className="ld-pricing-inner">
          <div className="ld-section-tag">Pricing</div>
          <h2 className="ld-section-title">Simple, honest pricing.</h2>
          <p className="ld-section-sub" style={{margin:"0 auto"}}>Start free. Upgrade when you're ready.</p>
          <div className="ld-price-grid">
            {/* FREE */}
            <div className="ld-price-card">
              <div className="ld-tier">Free Trial</div>
              <div className="ld-amount">₹0 <span>/ forever</span></div>
              <div className="ld-price-desc">Perfect to explore and get started.</div>
              <ul className="ld-price-list">
                <li>Smart Ledger Tables</li>
                <li>Basic Invoice creation</li>
                <li>PDF export (5/month)</li>
                <li className="dim">Unlimited tables</li>
                <li className="dim">Excel export</li>
                <li className="dim">Priority support</li>
                <li className="dim">Multi-user access</li>
              </ul>
              <a href="/auth" className="ld-btn-plan ld-btn-outline">Get Started Free</a>
            </div>
            {/* PREMIUM */}
            <div className="ld-price-card popular">
              <div className="ld-popular-badge">Most Popular</div>
              <div className="ld-tier green">Premium</div>
              <div className="ld-amount">₹199 <span>/ month</span></div>
              <div className="ld-price-desc">Everything you need to run your business.</div>
              <ul className="ld-price-list">
                <li>Everything in Free</li>
                <li>Unlimited tables & records</li>
                <li>Unlimited PDF & Excel export</li>
                <li>Professional Invoices & Quotations</li>
                <li>Dashboard with charts</li>
                <li>Priority support</li>
                <li className="dim">Multi-user access</li>
              </ul>
              <a href="/auth" className="ld-btn-plan ld-btn-filled">Start Premium →</a>
            </div>
            {/* BUSINESS */}
            <div className="ld-price-card" style={{borderColor:"var(--gold)", background:"linear-gradient(135deg,#fff 0%,#fdf8ee 100%)", position:"relative"}}>
              <div className="ld-popular-badge" style={{background:"var(--gold)"}}>For Teams</div>
              <div className="ld-tier" style={{color:"var(--gold)"}}>Business</div>
              <div className="ld-amount">₹1,500 <span>/ month</span></div>
              <div className="ld-price-desc">For growing businesses & teams.</div>
              <ul className="ld-price-list">
                <li>Everything in Premium</li>
                <li>Multi-user access (5 seats)</li>
                <li>Team collaboration tools</li>
                <li>Advanced analytics & reports</li>
                <li>Custom branding on invoices</li>
                <li>Dedicated account manager</li>
                <li>24/7 priority support</li>
              </ul>
              <a href="/auth" className="ld-btn-plan" style={{background:"var(--gold)", color:"#fff", display:"block", textAlign:"center"}}>Get Business Plan →</a>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <div className="ld-cta">
        <div className="ld-cta-inner">
          <div className="ld-section-tag" style={{color:"var(--sage-light)"}}>Get started today</div>
          <h2>Your business deserves<br />better tools.</h2>
          <p>Join small business owners who manage their accounts, invoices, and billing with Ledgerly — for free.</p>
          <div className="ld-cta-btns">
            <a href="/auth" className="ld-btn-cta-main">Start for Free →</a>
            <a href="#features" className="ld-btn-cta-ghost">See Features</a>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="ld-footer">
        <div className="ld-footer-logo">Ledger<span>ly</span></div>
        <div className="ld-footer-links">
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="#">Support</a>
          <a href="#">Contact</a>
        </div>
        <div className="ld-footer-copy">© 2025 Ledgerly. Made with ♥ for small businesses.</div>
      </footer>
    </>
  );
}
