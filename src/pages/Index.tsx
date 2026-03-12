<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Ledgerly — Smart Ledger, Invoice & Billing Tools</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
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
    --shadow: rgba(15,14,12,0.08);
  }

  html { scroll-behavior: smooth; }

  body {
    font-family: 'DM Sans', sans-serif;
    background: var(--paper);
    color: var(--ink);
    overflow-x: hidden;
  }

  /* ── NAV ── */
  nav {
    position: fixed; top: 0; left: 0; right: 0; z-index: 100;
    display: flex; align-items: center; justify-content: space-between;
    padding: 1.1rem 3rem;
    background: rgba(250,248,244,0.88);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .nav-logo {
    font-family: 'Instrument Serif', serif;
    font-size: 1.5rem;
    color: var(--ink);
    text-decoration: none;
    letter-spacing: -0.02em;
  }
  .nav-logo span { color: var(--sage); }
  .nav-links { display: flex; gap: 2rem; list-style: none; }
  .nav-links a { color: var(--muted); text-decoration: none; font-size: 0.9rem; font-weight: 500; transition: color .2s; }
  .nav-links a:hover { color: var(--ink); }
  .nav-cta {
    background: var(--sage); color: #fff;
    border: none; padding: .6rem 1.4rem;
    border-radius: 8px; font-size: .9rem; font-weight: 600;
    cursor: pointer; text-decoration: none;
    transition: background .2s, transform .15s;
  }
  .nav-cta:hover { background: var(--sage-light); transform: translateY(-1px); }

  /* ── HERO ── */
  .hero {
    min-height: 100vh;
    display: flex; align-items: center;
    padding: 8rem 3rem 4rem;
    position: relative;
    overflow: hidden;
  }
  .hero-bg {
    position: absolute; inset: 0; z-index: 0;
    background:
      radial-gradient(ellipse 70% 60% at 80% 20%, rgba(74,124,89,0.08) 0%, transparent 60%),
      radial-gradient(ellipse 50% 50% at 20% 80%, rgba(200,168,75,0.06) 0%, transparent 55%);
  }
  .hero-grid {
    position: absolute; inset: 0; z-index: 0; opacity: 0.03;
    background-image: linear-gradient(var(--ink) 1px, transparent 1px),
                      linear-gradient(90deg, var(--ink) 1px, transparent 1px);
    background-size: 40px 40px;
  }
  .hero-inner {
    position: relative; z-index: 1;
    max-width: 1200px; margin: 0 auto;
    display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center;
  }
  .hero-tag {
    display: inline-flex; align-items: center; gap: .5rem;
    background: var(--sage-dim); color: var(--sage);
    padding: .35rem .9rem; border-radius: 100px;
    font-size: .8rem; font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; margin-bottom: 1.4rem;
  }
  .hero-tag::before { content: '●'; font-size: .5rem; }
  h1 {
    font-family: 'Instrument Serif', serif;
    font-size: clamp(2.8rem, 5vw, 4.2rem);
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin-bottom: 1.4rem;
  }
  h1 em { color: var(--sage); font-style: italic; }
  .hero-sub {
    font-size: 1.1rem; color: var(--muted); line-height: 1.7;
    max-width: 460px; margin-bottom: 2.2rem;
  }
  .hero-actions { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .btn-primary {
    background: var(--ink); color: var(--paper);
    padding: .85rem 2rem; border-radius: 10px;
    font-size: 1rem; font-weight: 600;
    text-decoration: none; border: none; cursor: pointer;
    transition: background .2s, transform .15s, box-shadow .2s;
    box-shadow: 0 4px 16px rgba(15,14,12,0.18);
  }
  .btn-primary:hover { background: #2a2824; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(15,14,12,0.22); }
  .btn-secondary {
    color: var(--ink); text-decoration: none;
    font-size: .95rem; font-weight: 500;
    display: flex; align-items: center; gap: .4rem;
    border-bottom: 1px solid var(--border); padding-bottom: .1rem;
    transition: border-color .2s, color .2s;
  }
  .btn-secondary:hover { color: var(--sage); border-color: var(--sage); }
  .hero-trust {
    margin-top: 2.5rem;
    display: flex; align-items: center; gap: 1rem;
    font-size: .82rem; color: var(--muted);
  }
  .hero-trust-dots { display: flex; gap: -.3rem; }
  .hero-trust-dot {
    width: 28px; height: 28px; border-radius: 50%;
    border: 2px solid var(--paper);
    background: var(--sage-dim);
    margin-left: -6px; display: flex; align-items: center; justify-content: center;
    font-size: .65rem; font-weight: 700; color: var(--sage);
  }

  /* ── HERO MOCKUP ── */
  .hero-mockup {
    position: relative;
  }
  .mockup-card {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(15,14,12,0.12), 0 4px 16px rgba(15,14,12,0.06);
    overflow: hidden;
    transform: perspective(1000px) rotateY(-4deg) rotateX(2deg);
    transition: transform .4s ease;
  }
  .mockup-card:hover { transform: perspective(1000px) rotateY(0deg) rotateX(0deg); }
  .mockup-topbar {
    background: #f8f7f5; border-bottom: 1px solid var(--border);
    padding: .7rem 1rem; display: flex; align-items: center; gap: .5rem;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot-r { background: #ff6058; } .dot-y { background: #ffbd2e; } .dot-g { background: #28c840; }
  .mockup-url {
    margin-left: .5rem; flex: 1; background: #ede9e0; border-radius: 6px;
    padding: .25rem .7rem; font-size: .72rem; color: var(--muted);
  }
  .mockup-body { padding: 1.2rem; }
  .mockup-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 1rem;
  }
  .mockup-title { font-family: 'Instrument Serif', serif; font-size: 1.1rem; }
  .mockup-badge {
    background: var(--sage-dim); color: var(--sage);
    padding: .2rem .6rem; border-radius: 6px; font-size: .7rem; font-weight: 600;
  }
  .mockup-stats { display: grid; grid-template-columns: repeat(3,1fr); gap: .7rem; margin-bottom: 1rem; }
  .stat-box {
    background: var(--cream); border-radius: 10px; padding: .8rem;
    border: 1px solid var(--border);
  }
  .stat-label { font-size: .65rem; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: .05em; }
  .stat-val { font-size: 1.15rem; font-weight: 700; margin-top: .2rem; }
  .stat-val.green { color: var(--sage); }
  .mockup-table { width: 100%; border-collapse: collapse; font-size: .72rem; }
  .mockup-table th {
    background: var(--cream); padding: .4rem .6rem; text-align: left;
    font-weight: 600; color: var(--muted); font-size: .65rem; text-transform: uppercase; letter-spacing: .04em;
  }
  .mockup-table td { padding: .45rem .6rem; border-bottom: 1px solid var(--border); }
  .mockup-table tr:last-child td { border-bottom: none; }
  .status-pill {
    padding: .15rem .5rem; border-radius: 100px; font-size: .6rem; font-weight: 600;
  }
  .status-paid { background: #d4e6da; color: var(--sage); }
  .status-pending { background: #fef3c7; color: #92400e; }
  .floating-tag {
    position: absolute; bottom: -1rem; left: -1.5rem;
    background: #fff; border: 1px solid var(--border);
    border-radius: 12px; padding: .7rem 1rem;
    box-shadow: 0 8px 24px rgba(15,14,12,0.1);
    display: flex; align-items: center; gap: .6rem;
    font-size: .78rem; font-weight: 600; white-space: nowrap;
    animation: floatY 3s ease-in-out infinite;
  }
  .floating-tag2 {
    position: absolute; top: 1rem; right: -1rem;
    background: var(--sage); color: #fff;
    border-radius: 12px; padding: .6rem .9rem;
    box-shadow: 0 8px 24px rgba(74,124,89,0.3);
    font-size: .75rem; font-weight: 600;
    animation: floatY 3s ease-in-out infinite .8s;
  }
  @keyframes floatY {
    0%,100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }
  .icon-sm { font-size: 1rem; }

  /* ── LOGOS / SOCIAL PROOF ── */
  .logos-strip {
    padding: 2.5rem 3rem;
    border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
    background: var(--cream);
  }
  .logos-inner {
    max-width: 1000px; margin: 0 auto;
    display: flex; align-items: center; justify-content: center;
    gap: 3rem; flex-wrap: wrap;
  }
  .logos-label { font-size: .8rem; color: var(--muted); font-weight: 500; white-space: nowrap; }
  .logo-item { font-family: 'Instrument Serif', serif; font-size: 1.1rem; color: #b0a898; font-weight: 400; }

  /* ── HOW IT WORKS ── */
  .section { padding: 6rem 3rem; }
  .section-inner { max-width: 1100px; margin: 0 auto; }
  .section-tag {
    font-size: .78rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    color: var(--sage); margin-bottom: .8rem;
  }
  .section-title {
    font-family: 'Instrument Serif', serif;
    font-size: clamp(2rem, 3.5vw, 3rem);
    letter-spacing: -0.03em; line-height: 1.15;
    margin-bottom: 1rem;
  }
  .section-sub { color: var(--muted); font-size: 1.05rem; line-height: 1.7; max-width: 520px; }

  .steps-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 1.5rem; margin-top: 3.5rem; }
  .step-card {
    background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 2rem;
    position: relative; overflow: hidden;
    transition: transform .25s, box-shadow .25s;
  }
  .step-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(15,14,12,0.1); }
  .step-num {
    font-family: 'Instrument Serif', serif; font-size: 3.5rem; color: var(--border);
    line-height: 1; margin-bottom: .8rem; font-style: italic;
  }
  .step-icon {
    width: 44px; height: 44px; background: var(--sage-dim); border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem; margin-bottom: 1rem;
  }
  .step-title { font-weight: 700; font-size: 1.05rem; margin-bottom: .5rem; }
  .step-desc { color: var(--muted); font-size: .9rem; line-height: 1.6; }

  /* ── FEATURES ── */
  .features-section { background: var(--ink); color: var(--paper); padding: 6rem 3rem; }
  .features-inner { max-width: 1100px; margin: 0 auto; }
  .features-section .section-tag { color: var(--sage-light); }
  .features-section .section-title { color: var(--paper); }
  .features-section .section-sub { color: #9e9890; }
  .features-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 1px; margin-top: 3rem; background: #2a2824; border: 1px solid #2a2824; border-radius: 20px; overflow: hidden; }
  .feat-item {
    background: #1a1916; padding: 2.5rem;
    transition: background .2s;
  }
  .feat-item:hover { background: #201f1c; }
  .feat-icon { font-size: 2rem; margin-bottom: 1rem; }
  .feat-title { font-weight: 700; font-size: 1.1rem; margin-bottom: .5rem; color: var(--paper); }
  .feat-desc { color: #7a7369; font-size: .9rem; line-height: 1.65; }
  .feat-highlight { color: var(--sage-light); font-weight: 600; }

  /* ── TESTIMONIALS ── */
  .testi-section { padding: 6rem 3rem; background: var(--cream); }
  .testi-inner { max-width: 1100px; margin: 0 auto; }
  .testi-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 1.5rem; margin-top: 3rem; }
  .testi-card {
    background: #fff; border: 1px solid var(--border); border-radius: 16px; padding: 1.8rem;
    display: flex; flex-direction: column; gap: 1rem;
    transition: transform .25s, box-shadow .25s;
  }
  .testi-card:hover { transform: translateY(-3px); box-shadow: 0 12px 32px rgba(15,14,12,0.08); }
  .testi-stars { color: var(--gold); font-size: 1rem; letter-spacing: .1em; }
  .testi-text { font-size: .92rem; line-height: 1.7; color: var(--ink); font-style: italic; }
  .testi-author { display: flex; align-items: center; gap: .8rem; margin-top: auto; }
  .testi-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--sage-dim); display: flex; align-items: center; justify-content: center;
    font-weight: 700; color: var(--sage); font-size: .8rem;
  }
  .testi-name { font-weight: 600; font-size: .88rem; }
  .testi-role { font-size: .78rem; color: var(--muted); }

  /* ── PRICING ── */
  .pricing-section { padding: 6rem 3rem; }
  .pricing-inner { max-width: 900px; margin: 0 auto; }
  .pricing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 3rem; }
  .price-card {
    border: 1px solid var(--border); border-radius: 20px; padding: 2.5rem;
    background: #fff;
    transition: transform .25s, box-shadow .25s;
  }
  .price-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(15,14,12,0.1); }
  .price-card.popular {
    border-color: var(--sage); border-width: 2px;
    background: linear-gradient(135deg, #fff 0%, #f2f8f4 100%);
    position: relative;
  }
  .popular-badge {
    position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
    background: var(--sage); color: #fff;
    padding: .3rem 1rem; border-radius: 100px;
    font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    white-space: nowrap;
  }
  .price-tier { font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: .8rem; }
  .price-tier.green { color: var(--sage); }
  .price-amount { font-family: 'Instrument Serif', serif; font-size: 3rem; line-height: 1; letter-spacing: -0.03em; }
  .price-amount span { font-family: 'DM Sans', sans-serif; font-size: 1rem; font-weight: 400; color: var(--muted); }
  .price-desc { color: var(--muted); font-size: .88rem; margin: .8rem 0 1.5rem; line-height: 1.5; }
  .price-features { list-style: none; display: flex; flex-direction: column; gap: .7rem; margin-bottom: 2rem; }
  .price-features li { font-size: .88rem; display: flex; align-items: center; gap: .6rem; }
  .price-features li::before { content: '✓'; color: var(--sage); font-weight: 700; }
  .price-features li.dim { color: var(--muted); }
  .price-features li.dim::before { content: '—'; color: var(--border); }
  .btn-plan {
    width: 100%; padding: .85rem; border-radius: 10px;
    font-size: .95rem; font-weight: 600; cursor: pointer; border: none;
    text-decoration: none; display: block; text-align: center;
    transition: all .2s;
  }
  .btn-plan-outline {
    background: transparent; border: 1.5px solid var(--border); color: var(--ink);
  }
  .btn-plan-outline:hover { border-color: var(--ink); }
  .btn-plan-filled { background: var(--sage); color: #fff; }
  .btn-plan-filled:hover { background: var(--sage-light); transform: translateY(-1px); }

  /* ── FINAL CTA ── */
  .cta-section {
    margin: 0 3rem 5rem;
    background: var(--ink); color: var(--paper);
    border-radius: 24px; padding: 5rem 4rem;
    text-align: center; position: relative; overflow: hidden;
  }
  .cta-section::before {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(ellipse 60% 80% at 50% -20%, rgba(74,124,89,0.3) 0%, transparent 60%);
  }
  .cta-inner { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; }
  .cta-section .section-tag { color: var(--sage-light); text-align: center; }
  .cta-section h2 {
    font-family: 'Instrument Serif', serif;
    font-size: clamp(2rem, 4vw, 3.2rem);
    letter-spacing: -0.03em; line-height: 1.1;
    color: var(--paper); margin-bottom: 1.2rem;
  }
  .cta-section p { color: #9e9890; font-size: 1rem; line-height: 1.7; margin-bottom: 2rem; }
  .cta-btns { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
  .btn-cta-main {
    background: var(--sage); color: #fff;
    padding: .9rem 2.2rem; border-radius: 10px;
    font-size: 1rem; font-weight: 600; text-decoration: none; border: none; cursor: pointer;
    transition: background .2s, transform .15s;
  }
  .btn-cta-main:hover { background: var(--sage-light); transform: translateY(-2px); }
  .btn-cta-ghost {
    border: 1.5px solid #3a3830; color: #9e9890;
    padding: .9rem 2.2rem; border-radius: 10px;
    font-size: 1rem; font-weight: 600; text-decoration: none;
    transition: border-color .2s, color .2s;
  }
  .btn-cta-ghost:hover { border-color: #6a6458; color: var(--paper); }

  /* ── FOOTER ── */
  footer {
    padding: 2.5rem 3rem; border-top: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 1rem;
  }
  .footer-logo { font-family: 'Instrument Serif', serif; font-size: 1.2rem; }
  .footer-logo span { color: var(--sage); }
  .footer-links { display: flex; gap: 1.8rem; }
  .footer-links a { font-size: .85rem; color: var(--muted); text-decoration: none; transition: color .2s; }
  .footer-links a:hover { color: var(--ink); }
  .footer-copy { font-size: .8rem; color: var(--muted); }

  /* ── ANIMATIONS ── */
  .fade-up {
    opacity: 0; transform: translateY(24px);
    animation: fadeUp .6s ease forwards;
  }
  .fade-up.d1 { animation-delay: .1s; }
  .fade-up.d2 { animation-delay: .22s; }
  .fade-up.d3 { animation-delay: .34s; }
  .fade-up.d4 { animation-delay: .46s; }
  .fade-up.d5 { animation-delay: .58s; }
  @keyframes fadeUp {
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── RESPONSIVE ── */
  @media(max-width: 900px) {
    nav { padding: 1rem 1.5rem; }
    .nav-links { display: none; }
    .hero { padding: 6rem 1.5rem 3rem; }
    .hero-inner { grid-template-columns: 1fr; gap: 3rem; }
    .hero-mockup { display: none; }
    .section, .features-section, .testi-section, .pricing-section { padding: 4rem 1.5rem; }
    .steps-grid, .features-grid, .testi-grid, .pricing-grid { grid-template-columns: 1fr; }
    .features-grid { border-radius: 16px; }
    .cta-section { margin: 0 1.5rem 3rem; padding: 3.5rem 2rem; }
    footer { padding: 2rem 1.5rem; flex-direction: column; text-align: center; }
  }
</style>
</head>
<body>

<!-- NAV -->
<nav>
  <a href="#" class="nav-logo">Ledger<span>ly</span></a>
  <ul class="nav-links">
    <li><a href="#how">How it works</a></li>
    <li><a href="#features">Features</a></li>
    <li><a href="#pricing">Pricing</a></li>
  </ul>
  <a href="#" class="nav-cta">Start Free →</a>
</nav>

<!-- HERO -->
<section class="hero">
  <div class="hero-bg"></div>
  <div class="hero-grid"></div>
  <div class="hero-inner">
    <div>
      <div class="hero-tag fade-up">For Small Businesses</div>
      <h1 class="fade-up d1">Your business,<br><em>brilliantly</em><br>organised.</h1>
      <p class="hero-sub fade-up d2">Smart ledger, professional invoices, quotations & PDF tools — everything your business needs, in one clean workspace.</p>
      <div class="hero-actions fade-up d3">
        <a href="#" class="btn-primary">Get Started Free</a>
        <a href="#how" class="btn-secondary">See how it works ↓</a>
      </div>
      <div class="hero-trust fade-up d4">
        <div class="hero-trust-dots">
          <div class="hero-trust-dot">R</div>
          <div class="hero-trust-dot">S</div>
          <div class="hero-trust-dot">M</div>
          <div class="hero-trust-dot">A</div>
        </div>
        <span>Trusted by small business owners across India</span>
      </div>
    </div>

    <!-- MOCKUP -->
    <div class="hero-mockup fade-up d5">
      <div class="mockup-card">
        <div class="mockup-topbar">
          <div class="dot dot-r"></div><div class="dot dot-y"></div><div class="dot dot-g"></div>
          <div class="mockup-url">ledgerly-smart-manage.vercel.app</div>
        </div>
        <div class="mockup-body">
          <div class="mockup-header">
            <div class="mockup-title">March 2025</div>
            <div class="mockup-badge">Premium ✦</div>
          </div>
          <div class="mockup-stats">
            <div class="stat-box">
              <div class="stat-label">Revenue</div>
              <div class="stat-val green">₹5,400</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Expenses</div>
              <div class="stat-val">₹0</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Net</div>
              <div class="stat-val green">₹5,400</div>
            </div>
          </div>
          <table class="mockup-table">
            <thead>
              <tr><th>Date</th><th>Name</th><th>Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              <tr><td>12 Mar</td><td>Rahul S.</td><td>₹1,200</td><td><span class="status-pill status-paid">Paid</span></td></tr>
              <tr><td>11 Mar</td><td>Priya M.</td><td>₹900</td><td><span class="status-pill status-paid">Paid</span></td></tr>
              <tr><td>10 Mar</td><td>Arun K.</td><td>₹2,100</td><td><span class="status-pill status-pending">Pending</span></td></tr>
              <tr><td>09 Mar</td><td>Sunita D.</td><td>₹1,200</td><td><span class="status-pill status-paid">Paid</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="floating-tag">
        <span class="icon-sm">📄</span> PDF exported!
      </div>
      <div class="floating-tag2">📊 EasyCount™</div>
    </div>
  </div>
</section>

<!-- LOGOS -->
<div class="logos-strip">
  <div class="logos-inner">
    <span class="logos-label">Used by businesses in</span>
    <span class="logo-item">Diagnostics</span>
    <span class="logo-item">Retail</span>
    <span class="logo-item">Clinics</span>
    <span class="logo-item">Freelancers</span>
    <span class="logo-item">Wholesalers</span>
    <span class="logo-item">Services</span>
  </div>
</div>

<!-- HOW IT WORKS -->
<section class="section" id="how">
  <div class="section-inner">
    <div class="section-tag">How it works</div>
    <h2 class="section-title">Up and running<br>in minutes.</h2>
    <p class="section-sub">No accountant needed. No complex software. Just sign up and start managing your business like a pro.</p>
    <div class="steps-grid">
      <div class="step-card">
        <div class="step-num">01</div>
        <div class="step-icon">🔐</div>
        <div class="step-title">Create your account</div>
        <div class="step-desc">Sign up for free in under 30 seconds. Your data stays private and secure — no one else can see it.</div>
      </div>
      <div class="step-card">
        <div class="step-num">02</div>
        <div class="step-icon">📋</div>
        <div class="step-title">Add your records</div>
        <div class="step-desc">Create tables, log transactions, and manage entries just like Excel — but smarter, faster, and in the cloud.</div>
      </div>
      <div class="step-card">
        <div class="step-num">03</div>
        <div class="step-icon">🚀</div>
        <div class="step-title">Invoice & export</div>
        <div class="step-desc">Generate professional invoices, quotations, and bills in one click. Export to PDF or Excel instantly.</div>
      </div>
    </div>
  </div>
</section>

<!-- FEATURES -->
<section class="features-section" id="features">
  <div class="features-inner">
    <div class="section-tag">Features</div>
    <h2 class="section-title" style="color:var(--paper)">Everything your business<br>actually needs.</h2>
    <p class="section-sub">Built specifically for Indian small businesses — no bloat, no complexity.</p>
    <div class="features-grid">
      <div class="feat-item">
        <div class="feat-icon">📊</div>
        <div class="feat-title">Smart Ledger Tables</div>
        <div class="feat-desc">Excel-like tables with <span class="feat-highlight">EasyCount™</span> formula support, custom styling, undo/redo, and bulk row/column management. Your accounts, your way.</div>
      </div>
      <div class="feat-item">
        <div class="feat-icon">🧾</div>
        <div class="feat-title">Professional Invoices</div>
        <div class="feat-desc">Create branded invoices, quotations, and bills in seconds. Auto-calculate totals, add your logo, and share directly with clients.</div>
      </div>
      <div class="feat-item">
        <div class="feat-icon">📁</div>
        <div class="feat-title">One-Click PDF Export</div>
        <div class="feat-desc">Export any table or document to a clean, professional PDF or Excel file. Perfect for sharing with accountants or filing records.</div>
      </div>
      <div class="feat-item">
        <div class="feat-icon">📈</div>
        <div class="feat-title">Dashboard Overview</div>
        <div class="feat-desc">See your revenue, expenses, and net balance at a glance. Visual charts and quick summaries keep you always in control.</div>
      </div>
      <div class="feat-item">
        <div class="feat-icon">🔒</div>
        <div class="feat-title">Private & Secure</div>
        <div class="feat-desc">Your financial data is encrypted and visible only to you. We don't sell your data, ever. Built with enterprise-grade security.</div>
      </div>
      <div class="feat-item">
        <div class="feat-icon">⚡</div>
        <div class="feat-title">Fast & Mobile-Ready</div>
        <div class="feat-desc">Works seamlessly on mobile, tablet, and desktop. Lightning-fast loading — manage your business from anywhere, anytime.</div>
      </div>
    </div>
  </div>
</section>

<!-- TESTIMONIALS -->
<section class="testi-section">
  <div class="testi-inner">
    <div class="section-tag">Testimonials</div>
    <h2 class="section-title">Loved by business<br>owners like you.</h2>
    <div class="testi-grid">
      <div class="testi-card">
        <div class="testi-stars">★★★★★</div>
        <div class="testi-text">"Pehle Excel mein sab kuch manually karta tha. Ab Ledgerly se invoices aur tables dono ek jagah ho jaate hain. Time bahut bachta hai!"</div>
        <div class="testi-author">
          <div class="testi-avatar">RK</div>
          <div><div class="testi-name">Ramesh Kumar</div><div class="testi-role">Medical Diagnostics, Pune</div></div>
        </div>
      </div>
      <div class="testi-card">
        <div class="testi-stars">★★★★★</div>
        <div class="testi-text">"The PDF export feature is a game changer. I send professional-looking bills to clients now and they're always impressed."</div>
        <div class="testi-author">
          <div class="testi-avatar">SP</div>
          <div><div class="testi-name">Sneha Patel</div><div class="testi-role">Freelance Designer, Ahmedabad</div></div>
        </div>
      </div>
      <div class="testi-card">
        <div class="testi-stars">★★★★★</div>
        <div class="testi-text">"EasyCount formula support is incredible. I track daily cash and online payments separately — exactly what my shop needed."</div>
        <div class="testi-author">
          <div class="testi-avatar">AJ</div>
          <div><div class="testi-name">Arjun Joshi</div><div class="testi-role">Wholesale Trader, Mumbai</div></div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- PRICING -->
<section class="pricing-section" id="pricing">
  <div class="pricing-inner" style="text-align:center">
    <div class="section-tag" style="text-align:center">Pricing</div>
    <h2 class="section-title">Simple, honest pricing.</h2>
    <p class="section-sub" style="margin:0 auto 0">Start free. Upgrade when you're ready.</p>
    <div class="pricing-grid" style="margin-top:3rem; text-align:left">
      <div class="price-card">
        <div class="price-tier">Free Trial</div>
        <div class="price-amount">₹0 <span>/ forever</span></div>
        <div class="price-desc">Perfect to explore and get started.</div>
        <ul class="price-features">
          <li>Smart Ledger Tables</li>
          <li>Basic Invoice creation</li>
          <li>PDF export (5/month)</li>
          <li class="dim">Unlimited tables</li>
          <li class="dim">Excel export</li>
          <li class="dim">Priority support</li>
        </ul>
        <a href="#" class="btn-plan btn-plan-outline">Get Started Free</a>
      </div>
      <div class="price-card popular">
        <div class="popular-badge">Most Popular</div>
        <div class="price-tier green">Premium</div>
        <div class="price-amount">₹199 <span>/ month</span></div>
        <div class="price-desc">Everything you need to run your business.</div>
        <ul class="price-features">
          <li>Everything in Free</li>
          <li>Unlimited tables & records</li>
          <li>Unlimited PDF & Excel export</li>
          <li>Professional Invoices & Quotations</li>
          <li>Dashboard with charts</li>
          <li>Priority support</li>
        </ul>
        <a href="#" class="btn-plan btn-plan-filled">Start Premium →</a>
      </div>
    </div>
  </div>
</section>

<!-- FINAL CTA -->
<div class="cta-section">
  <div class="cta-inner">
    <div class="section-tag">Get started today</div>
    <h2>Your business deserves<br>better tools.</h2>
    <p>Join thousands of small business owners who manage their accounts, invoices, and billing with Ledgerly — for free.</p>
    <div class="cta-btns">
      <a href="#" class="btn-cta-main">Start for Free →</a>
      <a href="#features" class="btn-cta-ghost">See Features</a>
    </div>
  </div>
</div>

<!-- FOOTER -->
<footer>
  <div class="footer-logo">Ledger<span>ly</span></div>
  <div class="footer-links">
    <a href="#">Privacy</a>
    <a href="#">Terms</a>
    <a href="#">Support</a>
    <a href="#">Contact</a>
  </div>
  <div class="footer-copy">© 2025 Ledgerly. Made with ♥ for small businesses.</div>
</footer>

</body>
</html>
