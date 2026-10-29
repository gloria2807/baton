// Roam: a fictional travel search site with flights, hotels near a venue, a booking flow that ends
// at a card-payment page, and an event guide with a sessions table.

import { AIRPORTS, EVENT, HOTELS, SESSIONS, findFlight, searchFlights, type Flight, type State } from './data.js';
import { html, money, page, type Raw } from './html.js';
import type { Site } from './router.js';

const CSS = `
:root{--bg:#fff8f3;--accent:#e2553a}
.top{display:flex;align-items:center;gap:30px;background:#fff;border-bottom:1px solid #f1e3da;padding:0 32px;height:62px}
.top .brand{font-weight:800;font-size:24px;color:#e2553a;letter-spacing:-.5px;margin-right:10px}
.top a{color:#57423a;font-weight:500}
.search{display:grid;grid-template-columns:repeat(4,1fr) auto;gap:14px;align-items:end}
.search .btn{height:44px}
.result{display:grid;grid-template-columns:1.4fr 1fr 1fr 160px;gap:18px;align-items:center;background:#fff;border:1px solid #f1e3da;border-radius:12px;padding:16px 22px;margin-bottom:12px}
.result .price{font-size:22px;font-weight:700;text-align:right}
.result .price small{display:block;font-size:12px;font-weight:500;color:#94a3b8}
.tag{display:inline-block;background:#fdeee8;color:#b2391f;font-size:12px;font-weight:600;border-radius:999px;padding:2px 10px;margin-right:6px}
.hero{background:linear-gradient(120deg,#ffe4d6,#fff3ea);border-radius:16px;padding:28px 32px;margin-bottom:28px}
.pay{max-width:560px}
`;

function nav(): Raw {
  return html`<header class="top"><span class="brand">roam</span><a href="/">Flights</a><a href="/hotels">Hotels</a><a href="/events/atlas-summit">Events</a><a href="/trips">My trips</a></header>`;
}

const view = (title: string, body: Raw) => ({ html: page({ title, site: 'Roam', css: CSS, nav: nav(), body }) });
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
const nights = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));

function airportSelect(name: string, value: string): Raw {
  return html`<select id="${name}" name="${name}">${Object.entries(AIRPORTS).map(([code, label]) => html`<option value="${code}" ${code === value ? 'selected' : ''}>${label}</option>`)}</select>`;
}

function flightForm(q: URLSearchParams): Raw {
  return html`<form class="search" method="get" action="/flights">
    <div><label for="from">From</label>${airportSelect('from', q.get('from') ?? 'LOS')}</div>
    <div><label for="to">To</label>${airportSelect('to', q.get('to') ?? 'LIS')}</div>
    <div><label for="depart">Depart</label><input id="depart" name="depart" type="date" value="${q.get('depart') ?? '2026-12-01'}"></div>
    <div><label for="max">Max price (USD)</label><input id="max" name="max" inputmode="numeric" placeholder="Any" value="${q.get('max') ?? ''}"></div>
    <button class="btn">Search flights</button></form>`;
}

function flightRow(f: Flight): Raw {
  return html`<div class="result" data-flight="${f.id}">
    <div><strong>${f.airline}</strong> · ${f.code}<br><span class="muted">${AIRPORTS[f.from] ?? f.from} → ${AIRPORTS[f.to] ?? f.to}</span></div>
    <div><strong>${f.depart} → ${f.arrive}</strong><br><span class="muted">${hm(f.durationMin)}</span></div>
    <div>${f.stops === 0 ? html`<span class="tag">Nonstop</span>` : html`${f.stops} stop${f.stops > 1 ? 's' : ''} <span class="muted">via ${f.via}</span>`}</div>
    <div class="price">${money(f.priceCents)}<small>per traveller</small><a class="btn" style="margin-top:6px" href="/book/flight/${f.id}">Select</a></div></div>`;
}

export function roam(state: () => State, port: number): Site {
  return {
    name: 'Roam',
    port,
    routes: [
      ['GET', /^\/$/, (req) =>
        view('Flights', html`<div class="hero"><h1>Where to next?</h1>${flightForm(req.query)}</div>
          <h2>Popular this month</h2><p class="muted">Lisbon · Accra · London · Nairobi</p>`)],
      ['GET', /^\/flights$/, (req) => {
        const from = req.query.get('from') ?? 'LOS';
        const to = req.query.get('to') ?? 'LIS';
        const date = req.query.get('depart') || '2026-12-01';
        const max = Number(req.query.get('max') || 0);
        const sort = req.query.get('sort') ?? 'best';
        let list = searchFlights(from, to, date).filter((f) => !max || f.priceCents <= max * 100);
        // "Best" balances price against travel time, the way travel sites rank by default.
        const score = (f: Flight) => f.priceCents / 100 + f.durationMin * 0.12 + f.stops * 25;
        list = [...list].sort(sort === 'price' ? (a, b) => a.priceCents - b.priceCents : (a, b) => score(a) - score(b));
        const sortLink = (k: string, label: string) => {
          const q = new URLSearchParams(req.query);
          q.set('sort', k);
          return html`<a class="btn ${sort === k ? '' : 'secondary'}" href="/flights?${q.toString()}">${label}</a>`;
        };
        return view('Flights', html`<div class="hero">${flightForm(req.query)}</div>
          <div class="row" style="justify-content:space-between"><h1 style="margin:0">${list.length} flights · ${AIRPORTS[from] ?? from} → ${AIRPORTS[to] ?? to} · ${date}</h1><div class="row">${sortLink('best', 'Best')}${sortLink('price', 'Cheapest')}</div></div>
          <div style="margin-top:18px">${list.length ? list.map(flightRow) : html`<p class="muted">No flights match. Try a higher max price.</p>`}</div>`);
      }],
      ['GET', /^\/hotels$/, (req) => {
        const checkin = req.query.get('checkin') || '2026-12-01';
        const checkout = req.query.get('checkout') || '2026-12-04';
        const max = Number(req.query.get('max') || 0);
        const walk = Number(req.query.get('walk') || 0);
        const n = nights(checkin, checkout);
        const list = HOTELS.filter((h) => (!max || h.nightlyCents <= max * 100) && (!walk || h.walkMinToVenue <= walk)).sort((a, b) => a.walkMinToVenue - b.walkMinToVenue);
        return view('Hotels', html`<div class="hero"><h1>Hotels near ${EVENT.venue}</h1><p class="muted">${EVENT.address}</p>
          <form class="search" method="get" action="/hotels">
          <div><label for="checkin">Check in</label><input id="checkin" name="checkin" type="date" value="${checkin}"></div>
          <div><label for="checkout">Check out</label><input id="checkout" name="checkout" type="date" value="${checkout}"></div>
          <div><label for="hmax">Max per night (USD)</label><input id="hmax" name="max" inputmode="numeric" placeholder="Any" value="${req.query.get('max') ?? ''}"></div>
          <div><label for="walk">Max walk to venue (min)</label><input id="walk" name="walk" inputmode="numeric" placeholder="Any" value="${req.query.get('walk') ?? ''}"></div>
          <button class="btn">Search hotels</button></form></div>
          <h1>${list.length} stays · ${n} night${n > 1 ? 's' : ''}</h1>
          ${list.map((h) => html`<div class="result" data-hotel="${h.id}">
            <div><strong>${h.name}</strong><br><span class="muted">${h.area} · ★ ${h.rating}</span></div>
            <div><strong>${h.walkMinToVenue} min walk</strong><br><span class="muted">to ${EVENT.venue}</span></div>
            <div>${h.perks.map((p) => html`<span class="tag">${p}</span>`)}</div>
            <div class="price">${money(h.nightlyCents)}<small>per night · ${money(h.nightlyCents * n)} total</small><a class="btn" style="margin-top:6px" href="/book/hotel/${h.id}?checkin=${checkin}&checkout=${checkout}">Select</a></div></div>`)}`);
      }],
      ['GET', /^\/book\/(flight|hotel)\/([\w-]+)$/, (req) => {
        const [kind, id] = req.params as ['flight' | 'hotel', string];
        let summary: Raw;
        let total: number;
        if (kind === 'flight') {
          const f = findFlight(id);
          if (!f) return { html: 'Flight not found', status: 404 };
          summary = html`<strong>${f.airline} ${f.code}</strong>, ${f.date} ${f.depart} → ${f.arrive}`;
          total = f.priceCents;
        } else {
          const h = HOTELS.find((x) => x.id === id);
          if (!h) return { html: 'Hotel not found', status: 404 };
          const ci = req.query.get('checkin') || '2026-12-01';
          const co = req.query.get('checkout') || '2026-12-04';
          summary = html`<strong>${h.name}</strong>, ${ci} to ${co}`;
          total = h.nightlyCents * nights(ci, co);
        }
        return view('Traveller details', html`<h1>Traveller details</h1><div class="card pay"><p>${summary}<br>Total <strong>${money(total)}</strong></p>
          <form method="post" action="/book/${kind}/${id}">
          <input type="hidden" name="total" value="${total}">
          <label for="name">Full name</label><input id="name" name="name" autocomplete="name">
          <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email">
          <div class="row" style="margin-top:20px"><button class="btn">Continue to payment</button></div></form></div>`);
      }],
      ['POST', /^\/book\/(flight|hotel)\/([\w-]+)$/, (req) => {
        const s = state();
        const id = `RM-${1000 + s.bookings.length + 1}`;
        s.bookings.push({ id, kind: req.params[0] as 'flight' | 'hotel', itemId: req.params[1]!, traveller: req.body.get('name') ?? '', email: req.body.get('email') ?? '', totalCents: Number(req.body.get('total') || 0), status: 'awaiting-payment' });
        return { redirect: `/pay/${id}` };
      }],
      ['GET', /^\/pay\/(RM-\d+)$/, (req) => {
        const b = state().bookings.find((x) => x.id === req.params[0]);
        if (!b) return { html: 'Booking not found', status: 404 };
        if (b.status === 'confirmed') return { redirect: `/trips?ok=${b.id}` };
        return view('Payment', html`<h1>Payment</h1><div class="card pay"><p>Booking ${b.id} · total <strong>${money(b.totalCents)}</strong></p>
          <form method="post" action="/pay/${b.id}">
          <label for="cc-name">Name on card</label><input id="cc-name" name="ccname" autocomplete="cc-name">
          <label for="cc-number">Card number</label><input id="cc-number" name="cardnumber" inputmode="numeric" autocomplete="cc-number">
          <div class="grid2"><div><label for="cc-exp">Expiry</label><input id="cc-exp" name="exp" placeholder="MM/YY" autocomplete="cc-exp"></div>
          <div><label for="cc-csc">Security code</label><input id="cc-csc" name="cvc" inputmode="numeric" autocomplete="cc-csc"></div></div>
          <div class="row" style="margin-top:20px"><button class="btn">Pay ${money(b.totalCents)} and book</button></div></form></div>`);
      }],
      ['POST', /^\/pay\/(RM-\d+)$/, (req) => {
        const b = state().bookings.find((x) => x.id === req.params[0]);
        if (!b) return { html: 'Booking not found', status: 404 };
        const digits = (req.body.get('cardnumber') ?? '').replace(/\D/g, '');
        if (digits.length < 12) return { redirect: `/pay/${b.id}` };
        b.status = 'confirmed';
        return { redirect: `/trips?ok=${b.id}` };
      }],
      ['GET', /^\/trips$/, (req) => {
        const list = state().bookings;
        return view('My trips', html`<h1>My trips</h1>${req.query.get('ok') ? html`<div class="notice">Booking ${req.query.get('ok')} confirmed.</div>` : ''}
          ${list.length ? html`<table><thead><tr><th>Booking</th><th>Type</th><th>Total</th><th>Status</th></tr></thead><tbody>${list.map((b) => html`<tr><td>${b.id}</td><td>${b.kind}</td><td>${money(b.totalCents)}</td><td>${b.status === 'confirmed' ? 'Confirmed' : html`<a href="/pay/${b.id}">Awaiting payment</a>`}</td></tr>`)}</tbody></table>` : html`<p class="muted">No trips yet.</p>`}`);
      }],
      ['GET', /^\/events\/atlas-summit$/, () =>
        view(EVENT.name, html`<div class="hero"><h1>${EVENT.name}</h1><p>${EVENT.venue} · ${EVENT.address}<br>December 2–4, 2026</p>
          <a class="btn" href="/hotels?checkin=2026-12-01&checkout=2026-12-04">Hotels near the venue</a></div>
          <h2>Sessions</h2><table id="sessions"><thead><tr><th>Time</th><th>Session</th><th>Speaker</th><th>Room</th></tr></thead>
          <tbody>${SESSIONS.map((s) => html`<tr><td>${s.time}</td><td>${s.title}</td><td>${s.speaker}</td><td>${s.room}</td></tr>`)}</tbody></table>`)],
      ['GET', /^\/api\/bookings$/, () => ({ json: state().bookings })],
    ],
  };
}
