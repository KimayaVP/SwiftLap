const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType } = require('docx');
const fs = require('fs');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 24 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "0EA5E9" },
        paragraph: { spacing: { before: 400, after: 200 } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "1E293B" },
        paragraph: { spacing: { before: 300, after: 150 } } },
    ]
  },
  sections: [{
    properties: {
      page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
    },
    children: [
      // Title
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [
        new TextRun({ text: "🏊 SwiftLapLogic", size: 56, bold: true, color: "0EA5E9" })
      ]}),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [
        new TextRun({ text: "User Manual & Guide", size: 32, color: "64748B" })
      ]}),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [
        new TextRun({ text: "Version 1.0 - MVP Release", size: 24, italics: true, color: "94A3B8" })
      ]}),

      // What is SwiftLapLogic
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("What is SwiftLapLogic?")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("SwiftLapLogic is a swim performance tracking and coaching app designed for competitive swimmers and their coaches. Track your times, set goals, get personalized training plans, and compete with friends.")
      ]}),

      // Getting Started
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Getting Started")] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Creating an Account")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("1. Go to the app URL provided by your coach or admin")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("2. Click 'Sign Up' and enter your name, email, and password")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("3. Select your role: Swimmer or Coach")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("4. Click 'Sign Up' to create your account")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Logging In")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("Enter your email and password, then click 'Login'. Your dashboard will load automatically based on your role.")
      ]}),

      // For Swimmers
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("For Swimmers")] }),
      
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("📊 Logging Times")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("1. Find the 'Log Time' section on your dashboard")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("2. Select your stroke (Freestyle, Backstroke, Breaststroke, Butterfly, IM)")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("3. Select distance (50m, 100m, 200m, 400m)")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("4. Enter your time in minutes and seconds")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("5. Click 'Log Time' to save")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("🎯 Setting Goals")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("1. Go to the 'Goals' section")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("2. Select stroke and distance")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("3. Enter your target time")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("4. Set a target date")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("5. Click any goal to make it your 'Active Goal' for training plans")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("📋 Training Plans")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("Once you have an active goal and logged times, the app generates a personalized weekly training plan. Plans adjust based on how far you are from your goal (high intensity, moderate, or maintenance).")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("🎥 Video Upload")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("1. Record your swim technique on your phone")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("2. Click 'Upload Video' in the app")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("3. Select your stroke type")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("4. View AI-generated feedback on your technique")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("👥 Friend Groups")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Create a group: Click '+ Create Group', name it, and share the invite code with friends")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("Join a group: Enter the 6-character invite code from a friend")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("🏁 Meet Results")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("1. Click '+ Add Meet' to create a competition")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("2. Add race results with times, places, and medals")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("3. The app automatically detects Personal Bests (PBs)!")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("🏅 Achievements & Badges")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("Earn badges automatically: First Splash (first time logged), Goal Crusher (achieve a goal), Streak Master (7-day streak), and more. Coaches can also award custom badges!")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("⚙️ Privacy Settings")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("Toggle 'Show on Leaderboard' in Settings to hide your times from public rankings while still tracking your progress privately.")
      ]}),

      // For Coaches
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("For Coaches")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("👥 Managing Swimmers")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Swimmers request to join: They search for your name and send a request")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("You invite swimmers: Enter their email to send an invite")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("Accept/reject requests in the 'Pending Requests' section")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("📊 Dashboard Overview")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("View all swimmers at a glance: goals achieved, sessions this month, streaks, and status (ahead/behind/on track). Color-coded cards help identify who needs attention.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("📦 Batches")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Create batches to organize swimmers (e.g., 'Sprinters', 'Distance', 'Beginners')")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Add/remove swimmers from batches")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("View batch-specific leaderboards")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("💬 Comments & Reactions")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Click 'Comment' on any swimmer to view their recent times")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Send quick reactions: 🔥 💪 👏 ⭐")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("Write personalized comments - swimmers see these on their dashboard")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("🏅 Awarding Badges")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Click 'Award' on any swimmer")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("Select from badge library: Star Performer, Champion, Most Improved, etc.")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("Add a personal message (optional)")] }),

      // Tips
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Tips for Success")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("• Log times consistently to build accurate progress tracking")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("• Set realistic goals with achievable target dates")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("• Check your training plan weekly and follow the workouts")] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun("• Maintain your streak by logging at least one time per day")] }),
      new Paragraph({ spacing: { after: 200 }, children: [new TextRun("• Join friend groups to stay motivated through friendly competition")] }),

      // Troubleshooting
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Troubleshooting")] }),
      new Paragraph({ spacing: { after: 100 }, children: [
        new TextRun({ text: "Can't login? ", bold: true }), new TextRun("Check your email/password. Try signing up if you don't have an account.")
      ]}),
      new Paragraph({ spacing: { after: 100 }, children: [
        new TextRun({ text: "Training plan not showing? ", bold: true }), new TextRun("Make sure you have an active goal AND at least one logged time.")
      ]}),
      new Paragraph({ spacing: { after: 100 }, children: [
        new TextRun({ text: "Can't find coach? ", bold: true }), new TextRun("Ask your coach for their exact name as registered in the app.")
      ]}),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun({ text: "Video upload failed? ", bold: true }), new TextRun("Keep videos under 50MB. MP4 format works best.")
      ]}),

      // Contact
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Feedback & Support")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("This is an MVP release. We want your feedback! Report bugs, suggest features, or share your experience with the app creator.")
      ]}),

      // Footer
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600 }, children: [
        new TextRun({ text: "SwiftLapLogic v1.0 - Built with ❤️ for swimmers", size: 20, color: "94A3B8", italics: true })
      ]}),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("docs/SwiftLapLogic-User-Manual.docx", buffer);
  console.log("✅ Manual created: docs/SwiftLapLogic-User-Manual.docx");
});
