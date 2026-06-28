function parseFr(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return value;
  const s = String(value).trim().replace(',', '.');
  if (s === '') return NaN;
  return parseFloat(s);
}

function parseCoef(value) {
  const n = parseFr(value);
  return isNaN(n) || n <= 0 ? 1 : n;
}

function formatMark(jsonData, overrides = {}) {
  let coefficient = parseCoef(jsonData.coef);
  let valueStr = (jsonData.valeur ?? '').toString().trim();
  let value = parseFr(jsonData.valeur);
  let valueOn = parseFr(jsonData.noteSur);
  if (isNaN(valueOn) || valueOn <= 0) valueOn = 20;

  let isEffective = !(jsonData.nonSignificatif || jsonData.enLettre);

  if (isNaN(value) || valueStr.length === 0) {
    let sum = 0;
    let count = 0;
    (jsonData.elementsProgramme || []).forEach((el) => {
      const v = parseFr(el.valeur);
      if (!isNaN(v)) {
        sum += v;
        count += 1;
      }
    });
    value = sum / (count || 1);
    if (count === 0 || value < 0) {
      isEffective = false;
      value = 0;
    }
    valueOn = 4;
  }

  const ov = overrides[jsonData.id];
  let overridden = false;
  if (ov) {
    if (ov.disabled) {
      isEffective = false;
      overridden = true;
    }
    if (ov.value !== undefined && ov.value !== null && !isNaN(parseFr(ov.value))) {
      value = parseFr(ov.value);
      valueStr = String(ov.value).replace('.', ',');
      valueOn = 20;
      overridden = true;
    }
    if (ov.coef !== undefined && ov.coef !== null && !isNaN(parseFr(ov.coef))) {
      coefficient = parseCoef(ov.coef);
      overridden = true;
    }
  }

  return {
    id: jsonData.id,
    title: jsonData.devoir,
    isEffective,
    value,
    valueOn,
    valueStr,
    classValue: parseFr(jsonData.moyenneClasse),
    coefficient,
    subjectCode: jsonData.codeMatiere,
    subSubjectCode: jsonData.codeSousMatiere,
    periodCode: (jsonData.codePeriode || '').substring(0, 4),
    date: jsonData.dateSaisie || jsonData.date || null,
    overridden,
    disabled: !!(ov && ov.disabled),
  };
}

function buildSubject(jsonData) {
  return {
    id: jsonData.id ?? jsonData.codeMatiere,
    name: jsonData.discipline || jsonData.codeMatiere,
    code: jsonData.codeMatiere || '---',
    subCode: jsonData.codeSousMatiere,
    isSubSubject: !!jsonData.sousMatiere,
    coefficient: parseCoef(jsonData.coef),
    subjectGroupID: jsonData.idGroupeMatiere,
    marks: [],
    subSubjects: new Map(),
    average: undefined,
    classAverage: undefined,
  };
}

function computeSubjectAverage(subject, isClass) {
  let sum = 0;
  let coef = 0;

  if (subject.subSubjects.size === 0) {
    for (const mark of subject.marks) {
      const has = isClass ? !isNaN(mark.classValue) : true;
      if (mark.isEffective && has) {
        const val = isClass ? mark.classValue : mark.value;
        sum += (val / mark.valueOn) * 20 * mark.coefficient;
        coef += mark.coefficient;
      }
    }
  }

  for (const sub of subject.subSubjects.values()) {
    const subAvg = computeSubjectAverage(sub, isClass);
    if (subAvg !== undefined) {
      sum += subAvg * sub.coefficient;
      coef += sub.coefficient;
    }
  }

  return coef === 0 ? undefined : sum / coef;
}

function collectMarks(subject) {
  const out = [];
  for (const m of subject.marks) {
    out.push({
      id: m.id,
      title: m.title,
      value: m.value,
      valueOn: m.valueOn,
      valueStr: m.valueStr,
      classValue: isNaN(m.classValue) ? null : m.classValue,
      coefficient: m.coefficient,
      isEffective: m.isEffective,
      subSubjectCode: m.subSubjectCode || null,
      overridden: !!m.overridden,
      disabled: !!m.disabled,
      simulated: !!m.simulated,
    });
  }
  return out;
}

function subjectAverageUpTo(subject, cutoff, isClass) {
  let sum = 0;
  let coef = 0;
  if (subject.subSubjects.size === 0) {
    for (const mark of subject.marks) {
      if (!mark.isEffective) continue;
      const t = mark._t;
      if (t !== null && t !== undefined && t > cutoff) continue;
      const val = isClass ? mark.classValue : mark.value;
      if (val === null || val === undefined || isNaN(val)) continue;
      sum += (val / mark.valueOn) * 20 * mark.coefficient;
      coef += mark.coefficient;
    }
  }
  for (const sub of subject.subSubjects.values()) {
    const a = subjectAverageUpTo(sub, cutoff, isClass);
    if (a !== undefined) {
      sum += a * sub.coefficient;
      coef += sub.coefficient;
    }
  }
  return coef === 0 ? undefined : sum / coef;
}

function generalAverageAt(subjects, excluded, cutoff, isClass) {
  let sum = 0;
  let coef = 0;
  for (const subject of subjects.values()) {
    if (excluded.has(subject.code)) continue;
    const a = subjectAverageUpTo(subject, cutoff, isClass);
    if (a !== undefined) {
      sum += a * subject.coefficient;
      coef += subject.coefficient;
    }
  }
  return coef === 0 ? null : sum / coef;
}

function buildHistory(subjects, excluded) {
  const timestamps = new Set();
  for (const subject of subjects.values()) {
    if (excluded.has(subject.code)) continue;
    const collect = (subj) => {
      for (const m of subj.marks) {
        if (!m.isEffective || m.simulated) continue;
        if (m._t !== null && m._t !== undefined) timestamps.add(m._t);
      }
      for (const ss of subj.subSubjects.values()) collect(ss);
    };
    collect(subject);
  }

  const sorted = [...timestamps].sort((a, b) => a - b);
  const points = [];
  for (const cutoff of sorted) {
    const me = generalAverageAt(subjects, excluded, cutoff, false);
    const cls = generalAverageAt(subjects, excluded, cutoff, true);
    if (me !== null) {
      points.push({ t: cutoff, value: me, classValue: cls });
    }
  }
  return points;
}

function computePeriod(periode, allMarks, excludedCodes = [], overrides = {}, simulated = {}) {
  const excluded = new Set(excludedCodes);
  const disciplines = periode?.ensembleMatieres?.disciplines || [];
  const subjects = new Map();

  for (const d of disciplines) {
    if (d.groupeMatiere) continue;
    const subject = buildSubject(d);

    if (!subject.isSubSubject) {
      if (!subjects.has(subject.code)) subjects.set(subject.code, subject);
    } else {
      let main = subjects.get(subject.code);
      if (!main) {
        main = buildSubject({ ...d, sousMatiere: false, codeSousMatiere: '' });
        main.name = subject.code;
        subjects.set(subject.code, main);
      }
      subject.name = (subject.name || '').replace(main.name, '').trim();
      main.subSubjects.set(subject.subCode, subject);
    }
  }

  const periodCode4 = (periode.codePeriode || '').substring(0, 4);
  const isAnnual = !!periode.annuel;
  for (const raw of allMarks) {
    const mark = formatMark(raw, overrides);
    if (!isAnnual && mark.periodCode !== periodCode4) continue;

    const ts = mark.date ? new Date(mark.date).getTime() : null;
    mark._t = ts !== null && !isNaN(ts) ? ts : null;

    let subject = subjects.get(mark.subjectCode);
    if (!subject) {
      subject = buildSubject({
        codeMatiere: mark.subjectCode,
        discipline: mark.subjectCode,
        coef: 1,
      });
      subjects.set(mark.subjectCode, subject);
    }

    if (mark.subSubjectCode && !subject.isSubSubject) {
      let sub = subject.subSubjects.get(mark.subSubjectCode);
      if (!sub) {
        sub = buildSubject({
          codeMatiere: mark.subjectCode,
          codeSousMatiere: mark.subSubjectCode,
          discipline: mark.subSubjectCode,
          coef: 1,
          sousMatiere: true,
        });
        subject.subSubjects.set(mark.subSubjectCode, sub);
      }
      sub.marks.push(mark);
    }
    subject.marks.push(mark);
  }

  const simForPeriod = simulated[periode.codePeriode] || [];
  for (const sm of simForPeriod) {
    const subject = subjects.get(sm.subjectCode);
    if (!subject) continue;
    subject.marks.push({
      id: sm.id,
      title: sm.title || 'Note simulée',
      isEffective: true,
      value: parseFr(sm.value),
      valueOn: 20,
      valueStr: String(sm.value).replace('.', ','),
      classValue: NaN,
      coefficient: parseCoef(sm.coef),
      subjectCode: sm.subjectCode,
      subSubjectCode: null,
      periodCode: periodCode4,
      overridden: false,
      disabled: false,
      simulated: true,
      _t: Date.now(),
    });
  }

  let genSum = 0;
  let genCoef = 0;
  let classSum = 0;
  let classCoef = 0;
  const subjectList = [];

  for (const subject of subjects.values()) {
    const avg = computeSubjectAverage(subject, false);
    const classAvg = computeSubjectAverage(subject, true);
    subject.average = avg;
    subject.classAverage = classAvg;

    const isExcluded = excluded.has(subject.code);

    if (avg !== undefined && !isExcluded) {
      genSum += avg * subject.coefficient;
      genCoef += subject.coefficient;
    }
    if (classAvg !== undefined && !isExcluded) {
      classSum += classAvg * subject.coefficient;
      classCoef += subject.coefficient;
    }

    const noteCount = subject.marks.filter((m) => m.isEffective).length;

    subjectList.push({
      id: subject.id,
      name: subject.name,
      code: subject.code,
      coef: subject.coefficient,
      average: avg ?? null,
      classAverage: classAvg ?? null,
      noteCount,
      excluded: isExcluded,
      marks: collectMarks(subject),
    });
  }

  const moyenneGenerale = genCoef === 0 ? null : genSum / genCoef;
  const moyenneClasse = classCoef === 0 ? null : classSum / classCoef;

  const valid = subjectList
    .filter((s) => !s.excluded && s.average !== null)
    .map((s) => s.average);
  const moyenneArithmetique =
    valid.length === 0 ? null : valid.reduce((a, b) => a + b, 0) / valid.length;

  const history = buildHistory(subjects, excluded);

  return {
    id: periode.codePeriode,
    name: periode.periode,
    annuel: !!periode.annuel,
    cloture: !!periode.cloture,
    dateDebut: periode.dateDebut || null,
    dateFin: periode.dateFin || null,
    periodeActuelle: !!(periode.periodeActuelle || periode.actuelle),
    subjects: subjectList,
    moyenneGenerale,
    moyenneClasse,
    moyenneArithmetique,
    history,
  };
}

function findCurrentPeriodId(periods) {
  if (!periods.length) return null;

  const real = periods.filter((p) => !p.annuel);
  const pool = real.length ? real : periods;

  const flagged = pool.find((p) => p.periodeActuelle);
  if (flagged) return flagged.id;

  const now = Date.now();
  const byDate = pool.find((p) => {
    if (!p.dateDebut || !p.dateFin) return false;
    const d1 = new Date(p.dateDebut).getTime();
    const d2 = new Date(p.dateFin).getTime();
    return !isNaN(d1) && !isNaN(d2) && now >= d1 && now <= d2;
  });
  if (byDate) return byDate.id;

  const open = pool.find((p) => !p.cloture);
  if (open) return open.id;

  const dated = pool
    .filter((p) => p.dateDebut)
    .sort((a, b) => new Date(b.dateDebut) - new Date(a.dateDebut));
  if (dated.length) return dated[0].id;

  return pool[pool.length - 1].id;
}

function computeAllPeriods(notesPayload, excludedCodes = [], overrides = {}, simulated = {}) {
  if (!notesPayload) return { periods: [], currentPeriodId: null };
  const periodes = notesPayload.periodes || [];
  const notes = notesPayload.notes || [];
  const periods = periodes
    .map((p) => computePeriod(p, notes, excludedCodes, overrides, simulated))
    .filter((p) => p.subjects.length > 0);
  return { periods, currentPeriodId: findCurrentPeriodId(periods) };
}

module.exports = {
  parseFr,
  formatMark,
  computeSubjectAverage,
  computePeriod,
  computeAllPeriods,
};
