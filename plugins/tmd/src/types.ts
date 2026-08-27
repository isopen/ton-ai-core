export type TmdEntityType =
  | 'messageEntityBold'
  | 'messageEntityItalic'
  | 'messageEntityUnderline'
  | 'messageEntityStrike'
  | 'messageEntitySpoiler'
  | 'messageEntityCode'
  | 'messageEntityPre'
  | 'messageEntityTextLink'
  | 'messageEntityBlockquote';

export interface TmdEntity {
  _: TmdEntityType;
  offset: number;
  length: number;

  url?: string;

  language?: string;
}

export interface TmdParseResult {
  text: string;

  entities: TmdEntity[];

  srcToPlain: number[];
}
