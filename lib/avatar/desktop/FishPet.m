#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

// A borderless accessory panel. The plugin and this child communicate only through its pipes.
@interface PetPanel : NSPanel
@end
@implementation PetPanel
- (BOOL)canBecomeKeyWindow {
  return YES;
}
@end

static void emit(NSDictionary *message) {
  if (![NSJSONSerialization isValidJSONObject:message])
    return;
  NSMutableData *line = [[NSJSONSerialization dataWithJSONObject:message options:0 error:nil] mutableCopy];
  [line appendBytes:"\n" length:1];
  [[NSFileHandle fileHandleWithStandardOutput] writeData:line];
}

static const CGFloat petWidth = 252, petHeight = 352;
static NSString *const scaleKey = @"DSHFishPetScale";
static NSString *const anchorKey = @"DSHFishPetAnchor";
static NSString *const rightAnchorKey = @"DSHFishPetRightAnchor";

static NSSize peekSize(NSInteger scale) {
  CGFloat width = MAX(24, round(64 * scale / 100.));
  return NSMakeSize(width, round(width * 1152 / 804));
}

static NSScreen *screenForFrame(NSRect frame) {
  NSScreen *chosen = NSScreen.mainScreen;
  CGFloat best = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSRect overlap = NSIntersectionRect(frame, screen.visibleFrame);
    CGFloat area = NSWidth(overlap) * NSHeight(overlap);
    if (area > best) {
      best = area;
      chosen = screen;
    }
  }
  return chosen;
}

static NSRect fitFrame(NSRect frame, NSRect bounds) {
  frame.origin.x = MAX(NSMinX(bounds), MIN(NSMinX(frame), NSMaxX(bounds) - NSWidth(frame)));
  frame.origin.y = MAX(NSMinY(bounds), MIN(NSMinY(frame), NSMaxY(bounds) - NSHeight(frame)));
  return frame;
}

@interface PetApp : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate,
                              WKURLSchemeHandler, WKScriptMessageHandler, AVAudioRecorderDelegate>
@property(strong) PetPanel *panel;
@property(strong) WKWebView *web;
@property(copy) NSString *root;
@property BOOL dragging;
@property NSPoint dragAnchor, dragOrigin;
@property NSPoint petAnchor;
@property BOOL rightDocked;
@property BOOL sleepingScene;
@property NSInteger scale;
@property CGFloat controlsHeight;
@property(strong) dispatch_source_t termination;
@property(strong) AVAudioRecorder *recorder;
@property(strong) NSURL *audioFile;
@property(copy) NSDictionary *micRequest;
@property(strong) NSNumber *generation;
@end
@implementation PetApp
- (void)layoutPet {
  if (self.dragging)
    return;
  if (self.rightDocked) {
    NSSize size = peekSize(self.scale);
    // Keep the anchor just inside this display, including when another display adjoins its right edge.
    NSScreen *screen = screenForFrame(NSMakeRect(self.petAnchor.x - 1, self.petAnchor.y, 1, size.height));
    if (!screen)
      return;
    NSRect bounds = screen.visibleFrame;
    self.petAnchor = NSMakePoint(NSMaxX(bounds) - 1,
                                 MAX(NSMinY(bounds), MIN(self.petAnchor.y, NSMaxY(bounds) - size.height)));
    if (self.controlsHeight > 0)
      size = NSMakeSize(MIN(petWidth, NSWidth(bounds)), MIN(self.controlsHeight, NSHeight(bounds)));
    NSRect frame = NSMakeRect(NSMaxX(bounds) - size.width, self.petAnchor.y, size.width, size.height);
    [self.panel setFrame:fitFrame(frame, bounds) display:YES];
    return;
  }
  CGFloat width = round(petWidth * self.scale / 100.);
  CGFloat height = round((self.sleepingScene ? petWidth * .64 + 7 : petHeight) * self.scale / 100.);
  NSRect compact = NSMakeRect(self.petAnchor.x - width / 2, self.petAnchor.y, width, height);
  NSScreen *screen = screenForFrame(compact);
  if (!screen)
    return;
  compact = fitFrame(compact, screen.visibleFrame);
  self.petAnchor = NSMakePoint(NSMidX(compact), NSMinY(compact));
  CGFloat controlsWidth = MIN(petWidth, NSWidth(screen.visibleFrame));
  NSRect frame = self.controlsHeight > 0
                     ? fitFrame(NSMakeRect(self.petAnchor.x - controlsWidth / 2, self.petAnchor.y, controlsWidth,
                                           MIN(self.controlsHeight, NSHeight(screen.visibleFrame))),
                                screen.visibleFrame)
                     : compact;
  [self.panel setFrame:frame display:YES];
}
- (void)finishDrag:(NSRect)next {
  NSScreen *screen = screenForFrame(next);
  if (!screen)
    return;
  NSRect bounds = screen.visibleFrame;
  CGFloat gap = NSMaxX(bounds) - NSMaxX(next);
  BOOL dock = gap <= (self.rightDocked ? 24 : 8);
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  if (dock) {
    NSSize size = peekSize(self.scale);
    CGFloat y = self.rightDocked ? NSMinY(next) : NSMidY(next) - size.height / 2;
    NSRect badge = fitFrame(NSMakeRect(NSMaxX(bounds) - size.width, y, size.width, size.height), bounds);
    self.petAnchor = NSMakePoint(NSMaxX(bounds) - 1, NSMinY(badge));
    [defaults setObject:NSStringFromPoint(self.petAnchor) forKey:rightAnchorKey];
  } else {
    next = fitFrame(next, bounds);
    self.petAnchor = NSMakePoint(NSMidX(next), NSMinY(next));
    [defaults setObject:NSStringFromPoint(self.petAnchor) forKey:anchorKey];
    if (self.rightDocked)
      [defaults removeObjectForKey:rightAnchorKey];
  }
  if (dock != self.rightDocked) {
    self.rightDocked = dock;
    self.controlsHeight = 0;
    [self toPage:@{@"kind" : @"rightDock", @"docked" : @(dock)}];
  }
  [self layoutPet];
}
- (void)applicationDidChangeScreenParameters:(NSNotification *)note {
  if (self.panel)
    [self layoutPet];
}
- (void)toPage:(NSDictionary *)msg {
  [self.web callAsyncJavaScript:@"window.fishReceive(update)"
                      arguments:@{@"update" : msg}
                        inFrame:nil
                 inContentWorld:WKContentWorld.pageWorld
              completionHandler:nil];
}
- (void)cancelRecording {
  self.micRequest = nil;
  self.recorder.delegate = nil;
  [self.recorder stop];
  self.recorder = nil;
  if (self.audioFile)
    [[NSFileManager defaultManager] removeItemAtURL:self.audioFile error:nil];
  self.audioFile = nil;
}
- (void)micState:(NSString *)state error:(NSString *)error request:(NSDictionary *)req {
  [self toPage:@{
    @"kind" : @"mic",
    @"generation" : req[@"generation"],
    @"id" : req[@"id"],
    @"state" : state,
    @"error" : error ?: @""
  }];
}
- (void)startRecording:(NSDictionary *)req {
  if (![req[@"generation"] isEqual:self.generation] || ![req[@"id"] isKindOfClass:NSString.class])
    return;
  [self cancelRecording];
  self.micRequest = req;
  [AVCaptureDevice
      requestAccessForMediaType:AVMediaTypeAudio
              completionHandler:^(BOOL granted) {
                dispatch_async(dispatch_get_main_queue(), ^{
                  if (self.micRequest != req)
                    return;
                  if (!granted) {
                    [self micState:@"failed"
                             error:@"麦克风未获授权。请在系统设置的“隐私与安全性 → 麦克风”中允许访问。"
                           request:req];
                    [self cancelRecording];
                    return;
                  }
                  self.audioFile = [[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES]
                      URLByAppendingPathComponent:[NSString stringWithFormat:@"dsh-fish-%@.wav",
                                                                             NSUUID.UUID.UUIDString]];
                  NSError *err = nil;
                  self.recorder = [[AVAudioRecorder alloc] initWithURL:self.audioFile
                                                              settings:@{
                                                                AVFormatIDKey : @(kAudioFormatLinearPCM),
                                                                AVSampleRateKey : @16000,
                                                                AVNumberOfChannelsKey : @1,
                                                                AVLinearPCMBitDepthKey : @16,
                                                                AVLinearPCMIsFloatKey : @NO,
                                                                AVLinearPCMIsBigEndianKey : @NO
                                                              }
                                                                 error:&err];
                  self.recorder.delegate = self;
                  if (!self.recorder || ![self.recorder recordForDuration:30]) {
                    [self micState:@"failed"
                             error:err.localizedDescription ?: @"麦克风无法开始录音"
                           request:req];
                    [self cancelRecording];
                    return;
                  }
                  [self micState:@"recording" error:nil request:req];
                });
              }];
}
- (void)audioRecorderDidFinishRecording:(AVAudioRecorder *)recorder successfully:(BOOL)ok {
  if (recorder != self.recorder || !self.micRequest)
    return;
  NSDictionary *req = self.micRequest;
  NSData *audio = ok ? [NSData dataWithContentsOfURL:self.audioFile] : nil;
  [self cancelRecording];
  if (audio.length < 46) {
    [self micState:@"failed" error:@"没有录到声音，请再试一次。" request:req];
    return;
  }
  [self micState:@"transcribing" error:nil request:req];
  emit(@{
    @"kind" : @"recorded",
    @"generation" : req[@"generation"],
    @"id" : req[@"id"],
    @"audio" : [audio base64EncodedStringWithOptions:0]
  });
}
- (void)audioRecorderEncodeErrorDidOccur:(AVAudioRecorder *)recorder error:(NSError *)error {
  if (recorder != self.recorder || !self.micRequest)
    return;
  [self micState:@"failed" error:error.localizedDescription request:self.micRequest];
  [self cancelRecording];
}
- (void)applicationWillTerminate:(NSNotification *)note {
  [self cancelRecording];
}
- (void)applicationDidFinishLaunching:(NSNotification *)note {
  signal(SIGTERM, SIG_IGN);
  self.termination =
      dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
  dispatch_source_set_event_handler(self.termination, ^{
    [NSApp terminate:nil];
  });
  dispatch_resume(self.termination);
  WKWebViewConfiguration *config = [WKWebViewConfiguration new];
  config.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
  config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
  [config setURLSchemeHandler:self forURLScheme:@"fishpet"];
  [config.userContentController addScriptMessageHandler:self name:@"fishPet"];
  NSRect desktop = NSScreen.mainScreen.visibleFrame;
  NSRect frame = NSMakeRect(NSMaxX(desktop) - petWidth - 20, NSMinY(desktop) + 36, petWidth, petHeight);
  self.panel =
      [[PetPanel alloc] initWithContentRect:frame
                                  styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                                    backing:NSBackingStoreBuffered
                                      defer:NO];
  self.panel.title = @"小肥鱼桌宠";
  self.panel.delegate = self;
  self.panel.releasedWhenClosed = NO;
  self.panel.level = NSFloatingWindowLevel;
  self.panel.opaque = NO;
  self.panel.backgroundColor = NSColor.clearColor;
  self.panel.hasShadow = NO;
  self.panel.hidesOnDeactivate = NO;
  self.panel.collectionBehavior =
      NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  NSInteger savedScale = [defaults integerForKey:scaleKey];
  self.scale = savedScale >= 20 && savedScale <= 100 ? savedScale : 100;
  NSString *savedAnchor = [defaults stringForKey:anchorKey];
  NSString *rightAnchor = [defaults stringForKey:rightAnchorKey];
  if (rightAnchor) {
    self.rightDocked = YES;
    self.petAnchor = NSPointFromString(rightAnchor);
  } else if (savedAnchor) {
    self.petAnchor = NSPointFromString(savedAnchor);
  } else {
    // Migrate the old window position without saving transient, expanded controls as the pet's size.
    [self.panel setFrameUsingName:@"DSHFishPetPosition"];
    self.petAnchor = NSMakePoint(NSMidX(self.panel.frame), NSMinY(self.panel.frame));
  }
  [self layoutPet];
  self.web = [[WKWebView alloc] initWithFrame:self.panel.contentView.bounds configuration:config];
  self.web.underPageBackgroundColor = NSColor.clearColor;
  if ([self.web respondsToSelector:NSSelectorFromString(@"_setDrawsBackground:")])
    [self.web setValue:@NO forKey:@"drawsBackground"];
  self.web.navigationDelegate = self;
  self.panel.contentView = self.web;
  [self.web
      loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"fishpet://avatar/desktop/pet.html"]]];
  NSFileHandle *input = [NSFileHandle fileHandleWithStandardInput];
  NSMutableData *buffer = [NSMutableData data];
  input.readabilityHandler = ^(NSFileHandle *handle) {
    NSData *data = handle.availableData;
    if (!data.length) {
      handle.readabilityHandler = nil;
      dispatch_async(dispatch_get_main_queue(), ^{
        [NSApp terminate:nil];
      });
      return;
    }
    [buffer appendData:data];
    NSRange split;
    while ((split = [buffer rangeOfData:[NSData dataWithBytes:"\n" length:1]
                                options:0
                                  range:NSMakeRange(0, buffer.length)])
               .location != NSNotFound) {
      NSData *line = [buffer subdataWithRange:NSMakeRange(0, split.location)];
      [buffer replaceBytesInRange:NSMakeRange(0, NSMaxRange(split)) withBytes:NULL length:0];
      NSDictionary *msg = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
      if ([msg isKindOfClass:NSDictionary.class])
        dispatch_async(dispatch_get_main_queue(), ^{
          if ([msg[@"kind"] isEqual:@"front"]) {
            [self.panel orderFrontRegardless];
            return;
          }
          if ([msg[@"kind"] isEqual:@"bind"]) {
            [self cancelRecording];
            self.generation = msg[@"generation"];
          }
          [self toPage:msg];
        });
    }
  };
}
- (void)webView:(WKWebView *)web startURLSchemeTask:(id<WKURLSchemeTask>)task {
  NSURL *url = task.request.URL;
  NSString *name = [url.path hasPrefix:@"/"] ? [url.path substringFromIndex:1] : @"";
  NSSet *scripts = [NSSet setWithArray:@[
    @"desktop/pet.html", @"desktop/pet.css", @"desktop/pet.js", @"desktop/right-peek.png", @"controller.js", @"actions.js", @"voice.js",
    @"speech-text.js", @"cues.js", @"renderer.js", @"core.js", @"scenes.js", @"idle-rotation.js", @"purism.wasm"
  ]];
  NSDictionary *mime = @{
    @"html" : @"text/html; charset=utf-8",
    @"css" : @"text/css; charset=utf-8",
    @"js" : @"text/javascript; charset=utf-8",
    @"png" : @"image/png",
    @"wasm" : @"application/wasm",
    @"moc3" : @"application/octet-stream",
    @"json" : @"application/json"
  };
  BOOL model =
      ([name hasPrefix:@"model/"] || [name hasPrefix:@"scenes/"]) &&
      ![name.pathComponents containsObject:@".."] && [@[ @"json", @"moc3", @"png" ] containsObject:name.pathExtension];
  NSString *path = [[self.root stringByAppendingPathComponent:name] stringByResolvingSymlinksInPath];
  NSData *bytes = nil;
  if ([url.host isEqual:@"avatar"] && [task.request.HTTPMethod isEqual:@"GET"] &&
      ([scripts containsObject:name] || model) && [path hasPrefix:[self.root stringByAppendingString:@"/"]])
    bytes = [NSData dataWithContentsOfFile:path options:NSDataReadingMappedIfSafe error:nil];
  NSHTTPURLResponse *response =
      [[NSHTTPURLResponse alloc] initWithURL:url
                                  statusCode:bytes ? 200 : 404
                                 HTTPVersion:@"HTTP/1.1"
                                headerFields:@{
                                  @"Content-Type" : mime[name.pathExtension] ?: @"text/plain",
                                  @"Access-Control-Allow-Origin" : @"*",
                                  @"Cache-Control" : @"no-store"
                                }];
  [task didReceiveResponse:response];
  if (bytes)
    [task didReceiveData:bytes];
  [task didFinish];
}
- (void)webView:(WKWebView *)web stopURLSchemeTask:(id<WKURLSchemeTask>)task {
}
- (void)webView:(WKWebView *)web
    decidePolicyForNavigationAction:(WKNavigationAction *)action
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decision {
  NSURL *url = action.request.URL;
  decision(action.targetFrame.isMainFrame && [url.scheme isEqual:@"fishpet"] &&
                   [url.host isEqual:@"avatar"] && [url.path isEqual:@"/desktop/pet.html"]
               ? WKNavigationActionPolicyAllow
               : WKNavigationActionPolicyCancel);
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)web {
  emit(@{@"kind" : @"error", @"message" : @"桌宠渲染进程已退出，请重新打开桌宠。"});
  [NSApp terminate:nil];
}
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)nav withError:(NSError *)err {
  emit(@{@"kind" : @"error", @"message" : err.localizedDescription});
  [NSApp terminate:nil];
}
- (void)userContentController:(WKUserContentController *)ctrl didReceiveScriptMessage:(WKScriptMessage *)msg {
  if (!msg.frameInfo.isMainFrame || ![msg.frameInfo.request.URL.host isEqual:@"avatar"] ||
      ![msg.body isKindOfClass:NSDictionary.class])
    return;
  NSDictionary *m = msg.body;
  NSString *kind = m[@"kind"];
  if ([kind isEqual:@"layout"]) {
    if ([m[@"docked"] boolValue] != self.rightDocked)
      return;
    NSNumber *scale = m[@"scale"];
    if (![scale isKindOfClass:NSNumber.class] || scale.integerValue < 20 || scale.integerValue > 100)
      return;
    self.sleepingScene = [m[@"scene"] isEqual:@"sleep"];
    if (self.scale != scale.integerValue) {
      self.scale = scale.integerValue;
      [NSUserDefaults.standardUserDefaults setInteger:self.scale forKey:scaleKey];
    }
    NSNumber *height = m[@"height"];
    CGFloat measured = [height isKindOfClass:NSNumber.class] ? ceil(height.doubleValue) : petHeight;
    self.controlsHeight = [m[@"expanded"] boolValue] ? MAX(1, measured) : 0;
    [self layoutPet];
    return;
  }
  if ([kind isEqual:@"record"]) {
    [self startRecording:m];
    return;
  }
  if ([kind isEqual:@"stopRecord"]) {
    if ([m[@"generation"] isEqual:self.generation] && [m[@"id"] isEqual:self.micRequest[@"id"]]) {
      if (self.recorder)
        [self.recorder stop];
      else {
        [self micState:@"cancelled" error:nil request:self.micRequest];
        [self cancelRecording];
      }
    }
    return;
  }
  if ([kind isEqual:@"focus"]) {
    [self.panel makeKeyAndOrderFront:nil];
    [self.panel makeFirstResponder:self.web];
    [self.web evaluateJavaScript:@"document.getElementById('words').focus()" completionHandler:nil];
    return;
  }
  if ([kind isEqual:@"close"]) {
    [NSApp terminate:nil];
    return;
  }
  if ([kind isEqual:@"drag"]) {
    NSString *phase = m[@"phase"];
    NSPoint point = NSMakePoint([m[@"x"] doubleValue], [m[@"y"] doubleValue]);
    if ([phase isEqual:@"start"]) {
      self.dragging = YES;
      self.dragAnchor = point;
      self.dragOrigin = self.panel.frame.origin;
    } else if (self.dragging) {
      NSRect next = self.panel.frame;
      next.origin = NSMakePoint(self.dragOrigin.x + point.x - self.dragAnchor.x,
                                self.dragOrigin.y - point.y + self.dragAnchor.y);
      if ([phase isEqual:@"end"]) {
        self.dragging = NO;
        if (fabs(next.origin.x - self.dragOrigin.x) < 4 && fabs(next.origin.y - self.dragOrigin.y) < 4) {
          [self layoutPet];
          return;
        }
        [self finishDrag:next];
        return;
      }
      [self.panel setFrameOrigin:next.origin];
    }
    return;
  }
  if ([kind isEqual:@"ready"]) {
    [self toPage:@{@"kind" : @"initialScale", @"scale" : @(self.scale), @"docked" : @(self.rightDocked)}];
    [self.panel orderFrontRegardless];
  }
  emit(m);
}
- (void)windowWillClose:(NSNotification *)note {
  [NSApp terminate:nil];
}
@end
int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc != 2)
      return 2;
    PetApp *delegate = [PetApp new];
    delegate.root = [@(argv[1]) stringByResolvingSymlinksInPath];
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    NSApp.delegate = delegate;
    [NSApp run];
    return 0;
  }
}
