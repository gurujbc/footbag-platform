interface HofSection {
  heading: string;
  body: string;
}

interface HofLandingPage {
  page: {
    sectionKey: string;
    pageKey: string;
    title: string;
    intro: string;
    notice: string;
  };
  content: {
    sections: HofSection[];
  };
}

export const hofService = {
  getHofLandingPage(): HofLandingPage {
    return {
      page: {
        sectionKey: 'hof',
        pageKey: 'hof_index',
        title: 'Hall of Fame',
        intro: 'Honouring the pioneers and champions of footbag since 1997.',
        notice: 'Inductee profiles and full historical records are coming soon. Check back as we build out the archive.',
      },
      content: {
        sections: [
          {
            heading: 'A Bit of History',
            body: 'The Footbag Hall of Fame was founded in 1997 to honour the sport\'s pioneers and champions. The sport itself traces its roots to 1972, when Mike Marshall and John Stalberger invented footbag in Oregon. From casual play it grew into organised competition — consecutive kicks, freestyle, and net — and ultimately a global community.',
          },
          {
            heading: 'The Mike Marshall Award',
            body: 'Established in 1980, the Mike Marshall Award recognises players and contributors who have dedicated their time, energy, and love to the sport of footbag and its future. It memorialises Mike Marshall, who died in 1975 at age 28, before seeing the sport reach its full potential.',
          },
          {
            heading: 'Inductees',
            body: 'Hall of Fame inductees represent the highest level of achievement and contribution to footbag. Inductee records are maintained by the Footbag Historical Society and will appear here as the historical record is built out.',
          },
          {
            heading: 'Contact',
            body: 'For enquiries about the Hall of Fame, contact the Footbag Historical Society at director@footbaghalloffame.net.',
          },
        ],
      },
    };
  },
};
