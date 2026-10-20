import { strict as assert } from 'assert';
import { GOVERNOR_CLASS_DEFAULTS, TelegramRateGovernor } from '../governor';

describe('durevcode rate governor', () => {
    const clock = () => {
        let now = 1_000_000;
        return {
            now: () => now,
            tick: (ms: number) => { now += ms; },
            at: () => now,
        };
    };

    test('penalties are isolated per class: a draft outage never stops topic paints', () => {
        const t = clock();
        const gov = new TelegramRateGovernor(t.now, Math.random);
        gov.note429('draft', 15);
        assert.ok(gov.penaltyMsLeft('draft') > 14_000, 'the draft class sits in its penalty window');
        assert.equal(gov.penaltyMsLeft('topic-edit'), 0, 'topic edits stay free while drafts are penalized');
        assert.equal(gov.budget('topic-edit'), 40, 'topic budget untouched by the draft outage');
    });

    test('class budget drains on spend and refills per turn', () => {
        const t = clock();
        const gov = new TelegramRateGovernor(t.now, Math.random);
        assert.equal(gov.capacity('topic-document'), 2);
        assert.ok(gov.canSpend('topic-document'));
        gov.spend('topic-document');
        gov.spend('topic-document');
        assert.equal(gov.budget('topic-document'), 0, 'the two-document budget is drained');
        assert.ok(!gov.canSpend('topic-document'), 'a third document is refused by budget');
        assert.ok(gov.canSpend('topic-edit'), 'other classes still spend freely');
        gov.refill('topic-document');
        assert.ok(gov.canSpend('topic-document'), 'the turn boundary restores the budget');
    });

    test('draft failures pause flat and park after the fail limit', () => {
        const t = clock();
        const gov = new TelegramRateGovernor(t.now, Math.random);
        for (let i = 0; i < 4; i++) {
            const outcome = gov.registerFail('draft');
            assert.equal(outcome.parked, false, `failure ${i + 1} only pauses`);
            assert.equal(outcome.waitMs, 2000, 'the draft pause stays flat at 2s');
        }
        const parked = gov.registerFail('draft');
        assert.equal(parked.parked, true, `failure ${parked.attempt} parks the class`);
        gov.resetFails('draft');
        assert.equal(gov.fails('draft'), 0, 'a success clears the fail counter');
        const next = gov.registerFail('draft');
        assert.equal(next.parked, false, 'a fresh series starts clean after the reset');
    });

    test('topic-edit failures back off progressively up to the cap', () => {
        const t = clock();
        const gov = new TelegramRateGovernor(t.now, Math.random);
        const waits: number[] = [];
        for (let i = 0; i < 4; i++) waits.push(gov.registerFail('topic-edit').waitMs);
        assert.ok(waits[0] === 2400 && waits[1] === 3600 && waits[2] === 5400, `progression grows: ${waits}`);
        assert.ok(waits[3] <= 8000, 'the cap holds the line');
        assert.ok(waits[3] > waits[2], 'still monotonic under the cap');
    });

    test('full jitter stays inside the ceiling for every attempt', () => {
        const t = clock();
        const gov = new TelegramRateGovernor(t.now, () => 0.9999);
        assert.ok(gov.fullJitter(1000, 3, 20_000) <= 20_000, 'the cap fences the exponential');
        const gov0 = new TelegramRateGovernor(t.now, () => 0);
        assert.equal(gov0.fullJitter(1000, 3, 20_000), 0, 'zero rng lands at the floor');
        const govHalf = new TelegramRateGovernor(t.now, () => 0.5);
        assert.equal(govHalf.fullJitter(1000, 0, 20_000), 500, 'the midpoint splits the first attempt');
    });

    test('decorrelated stays anchored at the base and fences the cap', () => {
        const t = clock();
        const gov = new TelegramRateGovernor(t.now, () => 0);
        assert.equal(gov.decorrelated(2400, 4000, 8000), 2400, 'zero rng anchors at the base');
        const govMax = new TelegramRateGovernor(t.now, () => 0.9999);
        const spread = govMax.decorrelated(2400, 4000, 8000);
        assert.ok(spread <= 8000, 'the cap fences the decorrelated spread');
        assert.ok(spread >= 2400, 'the base anchors the floor');
    });

    test('class configs cover the wired scopes with sane capacities', () => {
        assert.equal(GOVERNOR_CLASS_DEFAULTS['topic-edit'].capacity, 40);
        assert.equal(GOVERNOR_CLASS_DEFAULTS['topic-send'].capacity, 24);
        assert.equal(GOVERNOR_CLASS_DEFAULTS['topic-markup'].capacity, 8);
        assert.equal(GOVERNOR_CLASS_DEFAULTS['topic-document'].capacity, 2);
        assert.equal(GOVERNOR_CLASS_DEFAULTS.draft.failBaseMs, 2000, 'draft pauses stay exactly as the resilient lane promises');
        assert.equal(GOVERNOR_CLASS_DEFAULTS.draft.failLimit, 4, 'parking arrives on the 5th failure');
    });

    test('unknown scopes fall back to gentle defaults instead of throwing', () => {
        const t = clock();
        const gov = new TelegramRateGovernor(t.now, Math.random);
        assert.equal(gov.capacity('mystery'), 10);
        assert.ok(gov.canSpend('mystery'));
        gov.spend('mystery');
        assert.equal(gov.budget('mystery'), 9);
    });
});
