import { strict as assert } from 'assert';
import { TLSerializer } from '@ton-ai/tl-language';
import { TelegramClientPlugin } from '../src/index';

type ParsedSentCode = {
    phoneCodeHash: string;
    type: string;
    nextType?: string;
    timeout?: number;
};

function parse(body: (s: TLSerializer) => void): ParsedSentCode {
    const s = new TLSerializer();
    s.writeUint32(0x5e002502);
    body(s);
    return (TelegramClientPlugin.prototype as any).parseAuthSentCode.call({}, s.toBuffer());
}

function sentCode(flags: number, typeCtor: number, writeType: (s: TLSerializer) => void, tail?: (s: TLSerializer) => void) {
    return parse((s) => {
        s.writeInt32(flags);
        s.writeUint32(typeCtor);
        writeType(s);
        s.writeString('hash-1');
        tail?.(s);
    });
}

test('parseAuthSentCode handles legacy sms/app/call/flash/missed types', () => {
    assert.equal(sentCode(0, 0xc000bba2, (s) => s.writeInt32(5)).type, 'sms');
    assert.equal(sentCode(0, 0x3dbb5986, (s) => s.writeInt32(5)).type, 'app');
    assert.equal(sentCode(0, 0x5353e5a7, (s) => s.writeInt32(5)).type, 'call');
    assert.equal(sentCode(0, 0xab03c6d9, (s) => s.writeString('*')).type, 'flash');
    assert.equal(sentCode(0, 0x82006484, (s) => { s.writeString('+1'); s.writeInt32(5); }).type, 'missed');
});

test('parseAuthSentCode handles emailCode with optional reset fields', () => {
    const parsed = sentCode(0, 0xf450f59b, (s) => {
        s.writeInt32(0b11000);
        s.writeString('user@example.com');
        s.writeInt32(6);
        s.writeInt32(60);
        s.writeInt32(1700000000);
    });
    assert.equal(parsed.type, 'email');
    assert.equal(parsed.phoneCodeHash, 'hash-1');
});

test('parseAuthSentCode handles setUpEmailRequired and fragmentSms', () => {
    assert.equal(sentCode(0, 0xa5491dea, (s) => s.writeInt32(0b11)).type, 'emailRequired');
    assert.equal(sentCode(0, 0xd9565c39, (s) => { s.writeString('https://fragment.com'); s.writeInt32(5); }).type, 'fragment');
});

test('parseAuthSentCode handles firebaseSms fields in wire order', () => {
    const parsed = sentCode(0, 0x9fd736, (s) => {
        s.writeInt32(0b111);
        s.writeBytes(Buffer.alloc(4, 1));
        s.writeInt64(123n);
        s.writeBytes(Buffer.alloc(4, 2));
        s.writeString('receipt');
        s.writeInt32(30);
        s.writeInt32(6);
    });
    assert.equal(parsed.type, 'firebase');
    assert.equal(parsed.phoneCodeHash, 'hash-1');
});

test('parseAuthSentCode handles smsWord/smsPhrase', () => {
    assert.equal(sentCode(0, 0xa416ac81, (s) => { s.writeInt32(1); s.writeString('Hello'); }).type, 'smsWord');
    assert.equal(sentCode(0, 0xb37794af, (s) => { s.writeInt32(0); }).type, 'smsPhrase');
});

test('parseAuthSentCode maps next_type constructors', () => {
    const withNext = (nextCtor: number) =>
        sentCode(2, 0xc000bba2, (s) => s.writeInt32(5), (s) => s.writeUint32(nextCtor));

    assert.equal(withNext(0x741cd3e3).nextType, 'call');
    assert.equal(withNext(0x226ccefb).nextType, 'call');
    assert.equal(withNext(0xd61ad6ee).nextType, 'call');
    assert.equal(withNext(0x72a3158c).nextType, 'sms');
});

test('parseAuthSentCode reads timeout', () => {
    const parsed = sentCode(4, 0xc000bba2, (s) => s.writeInt32(5), (s) => s.writeInt32(60));
    assert.equal(parsed.timeout, 60);
});
