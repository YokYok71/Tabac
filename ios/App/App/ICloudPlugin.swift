import Foundation
import Capacitor

@objc(ICloudPlugin)
public class ICloudPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ICloudPlugin"
    public let jsName = "ICloud"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]

    private let containerID = "iCloud.com.cavatabac.app"
    private let fileName = "cave-tabac-backup.json"

    private func getFileURL() -> URL? {
        guard let containerURL = FileManager.default.url(
            forUbiquityContainerIdentifier: containerID
        ) else { return nil }
        let docs = containerURL.appendingPathComponent("Documents")
        try? FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true, attributes: nil)
        return docs.appendingPathComponent(fileName)
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        let available = FileManager.default.url(forUbiquityContainerIdentifier: containerID) != nil
        call.resolve(["available": available])
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let data = call.getString("data") else {
            call.reject("Missing data")
            return
        }
        DispatchQueue.global(qos: .background).async {
            guard let url = self.getFileURL() else {
                DispatchQueue.main.async { call.reject("iCloud unavailable. Please check that you are signed in to iCloud and that iCloud Drive is enabled.") }
                return
            }
            do {
                try data.write(to: url, atomically: true, encoding: .utf8)
                DispatchQueue.main.async { call.resolve() }
            } catch {
                DispatchQueue.main.async { call.reject(error.localizedDescription) }
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .background).async {
            guard let url = self.getFileURL() else {
                DispatchQueue.main.async { call.reject("iCloud unavailable. Please check that you are signed in to iCloud and that iCloud Drive is enabled.") }
                return
            }
            guard FileManager.default.fileExists(atPath: url.path) else {
                DispatchQueue.main.async { call.reject("No backup found in iCloud Drive.") }
                return
            }
            do {
                let data = try String(contentsOf: url, encoding: .utf8)
                DispatchQueue.main.async { call.resolve(["data": data]) }
            } catch {
                DispatchQueue.main.async { call.reject(error.localizedDescription) }
            }
        }
    }
}
